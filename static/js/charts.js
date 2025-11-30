
// ---------------------- DRAW CHARTS (MAIN) ---------------------- //
function drawChartAndTable() {
  if (!state.currentAeTitle) {
    console.warn('[drawChartAndTable] currentAeTitle ว่าง');
    return;
  }

  console.log('[drawChartAndTable] start for', state.currentAeTitle, {
    bmeName: state.currentBmeName,
    brandModel: state.currentBrandModel,
    sapKeys: Object.keys(state.sapMap || {}).length,
    pacsRows: (state.pacsDataDetails || []).length,
    dates: (state.allUniqueDates || []).length,
    todayStr: state.todayStr,
  });

  const displayTitle =
    `${state.currentBmeName} [${state.currentBrandModel}] (${state.currentAeTitle})`;
  $(CONFIG.domIds.chartTitle).textContent =
    `แสดงกราฟวิเคราะห์สำหรับ: ${displayTitle}`;

  const seriesData = aggregateDataForChart(
    state.currentAeTitle,
    state.currentServiceFilter
  );
  if (!seriesData || !seriesData.length) {
    showError('ไม่พบข้อมูลสำหรับวาดกราฟ (seriesData ว่าง)');
    return;
  }

  const data = new google.visualization.DataTable();
  data.addColumn('date', 'Date');
  // ใช้ "รายได้ต่อเดือน" แทน "กำไร"
  data.addColumn('number', 'รายได้ต่อเดือน (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  // ใช้ "รายได้สะสม"
  data.addColumn('number', 'รายได้สะสม (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'รายจ่ายต่อเดือน (SAP)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'รายจ่ายสะสม (SAP)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'ราคาเครื่อง (Break-Even)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'ค่าเสื่อมต่อเดือน');
  data.addColumn({ type: 'string', role: 'style' });

  data.addRows(seriesData);

  // ใช้กับระบบ zoom (ข้อ 4 ด้วย)
  initChartDateBounds(data);

  try {
    drawMonthlyChart(data, displayTitle);
  } catch (e) {
    console.error('[drawChartAndTable] drawMonthlyChart ERROR', e);
    showError(e);
    return;
  }

  try {
    drawCumulativeChart(data, displayTitle);
  } catch (e) {
    console.error('[drawChartAndTable] drawCumulativeChart ERROR', e);
    showError(e);
    return;
  }

  try {
    drawServiceDetailsChart(
      state.currentAeTitle,
      state.currentMonthFilter,
      state.currentServiceFilter
    );
  } catch (e) {
    console.error('[drawChartAndTable] drawServiceDetailsChart ERROR', e);
    showError(e);
    return;
  }

  updateFilterStatus();
}



// ---------------------- MONTHLY CHART ---------------------- //
function drawMonthlyChart(fullData, displayTitle) {
  const range = getInitialDateRange(state.currentAeTitle);
  const view = new google.visualization.DataView(fullData);
  view.setColumns([0, 1, 2, 5, 6, 11, 12]);

  const options = {
    title: `รายเดือน: ${displayTitle}`,
    legend: { position: 'bottom' },
    chartArea: { width: '85%', height: '70%' },
    backgroundColor: { fill: '#fff' },
    vAxis: { title: 'จำนวนเงิน (บาท)', format: 'short' },
    hAxis: {
      title: 'วันที่',
      format: 'MMM yyyy',
      viewWindow: range ? { min: range.start, max: range.end } : undefined
    },
    seriesType: 'bars',
    series: {
      0: { type: 'bars', color: COLORS.revenueMonthly },
      1: { type: 'bars', color: COLORS.expenseMonthly },
      2: {
        type: 'line',
        lineWidth: 3,
        pointSize: 0,
        color: COLORS.depreciation,
        lineDashStyle: [4, 4]
      }
    },
    bar: { groupWidth: '90%' },
    explorer: { axis: 'horizontal', keepInBounds: true, maxZoomIn: 0.1 }
  };

  if (!state.chartMonthly) {
    state.chartMonthly = new google.visualization.ComboChart(
      $(CONFIG.domIds.chartMonthly)
    );
  }

  state.chartMonthly.draw(view, options);

  google.visualization.events.removeAllListeners(state.chartMonthly);
  google.visualization.events.addListener(state.chartMonthly, 'select', () => {
    const sel = state.chartMonthly.getSelection();
    if (!sel.length) return;

    const row = sel[0].row;
    if (row == null) return;

    const date = fullData.getValue(row, 0);
    const ym =
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    state.currentMonthFilter =
      state.currentMonthFilter === ym ? null : ym;
    state.serviceDetailsPage = 0;
    drawChartAndTable();
  });
}

// ---------------------- CUMULATIVE CHART ---------------------- //
function drawCumulativeChart(fullData, displayTitle) {
  const window = state.chartDateWindow || getInitialDateRange(state.currentAeTitle);

  // หาแถวที่ "รายได้สะสม" ตัดกับ "ราคาเครื่อง"
  let breakEvenRow = null;
  try {
    const numRows = fullData.getNumberOfRows();
    if (numRows > 0) {
      const capex = fullData.getValue(0, 9);
      if (capex != null) {
        let prev = fullData.getValue(0, 3);
        if (prev >= capex) breakEvenRow = 0;
        for (let i = 1; i < numRows && breakEvenRow === null; i++) {
          const cur = fullData.getValue(i, 3);
          if (prev < capex && cur >= capex) {
            breakEvenRow = i;
            break;
          }
          prev = cur;
        }
      }
    }
  } catch (err) {
    console.warn('[drawCumulativeChart] cannot compute break-even point', err);
  }

  const view = new google.visualization.DataView(fullData);
  view.setColumns([
    0, // date
    3, // cumulative revenue
    4, // style
    {
      type: 'string',
      role: 'annotation',
      calc: function (dt, row) {
        if (breakEvenRow != null && row === breakEvenRow) {
          return '⬆ จุดคุ้มทุน';
        }
        return null;
      }
    },
    7, // cumulative expense
    8, // style
    9, // capex
    10 // style
  ]);

  const options = {
    title: `สะสม: ${displayTitle}`,
    legend: { position: 'bottom' },
    chartArea: { width: '85%', height: '70%' },
    backgroundColor: { fill: '#fff' },
    vAxis: { title: 'จำนวนเงิน (บาท)', format: 'short' },
    hAxis: {
      title: 'วันที่',
      format: 'MMM yyyy',
      viewWindowMode: window ? 'explicit' : 'pretty',
      viewWindow: window ? { min: window.start, max: window.end } : undefined
    },
    seriesType: 'line',
    series: {
      0: { color: COLORS.revenueCumulative, lineWidth: 2, pointSize: 6 },
      1: { color: COLORS.expenseCumulative, lineWidth: 2, pointSize: 5 },
      2: {
        color: COLORS.capex,
        lineWidth: 2,
        lineDashStyle: [4, 4],
        pointSize: 0
      }
    },
    annotations: {
      stem: { length: 16 },
      style: 'point',
      textStyle: { fontSize: 12 }
    },
    explorer: { axis: 'horizontal', keepInBounds: true, maxZoomIn: 0.1 }
  };

  if (!state.chartCumulative) {
    state.chartCumulative = new google.visualization.ComboChart(
      $(CONFIG.domIds.chartCumulative)
    );
  }

  state.chartCumulative.draw(view, options);

  google.visualization.events.removeAllListeners(state.chartCumulative);
  google.visualization.events.addListener(state.chartCumulative, 'select', () => {
    const sel = state.chartCumulative.getSelection();
    if (!sel.length) return;

    const row = sel[0].row;
    if (row == null) return;

    const date = fullData.getValue(row, 0);
    const ym =
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    state.currentMonthFilter =
      state.currentMonthFilter === ym ? null : ym;
    state.serviceDetailsPage = 0;
    drawChartAndTable();
  });
}

// ---------------------- SERVICE DETAILS CHART ---------------------- //
function drawServiceDetailsChart(aeTitle, monthFilter, serviceFilter) {
  const containerCount = $(CONFIG.domIds.chartServiceDetails);
  const containerRevenue = document.getElementById('chart_div_service_revenue');

  // อัปเดตตัวเลือกปีใน dropdown
  updateYearFilterUI(aeTitle);

  const allDetails = Array.isArray(state.pacsDataDetails)
    ? state.pacsDataDetails
    : [];
  const yearFilter = state.currentYearFilter || null;

  const filtered = allDetails.filter(d => {
    if (d.aeTitle !== aeTitle) return false;
    if (monthFilter && d.yearMonth !== monthFilter) return false;
    if (yearFilter && (!d.yearMonth || d.yearMonth.substring(0, 4) !== yearFilter)) return false;
    return true;
  });

  if (!filtered.length) {
    const html = buildPlaceholderHtml(TEXTS.noServiceData);
    containerCount.innerHTML = html;
    if (containerRevenue) containerRevenue.innerHTML = html;
    $(CONFIG.domIds.servicePaginationControls).style.display = 'none';
    return;
  }

  const serviceSummary = new Map();
  for (const d of filtered) {
    const key = d.serviceCode || '-';
    if (!serviceSummary.has(key)) {
      serviceSummary.set(key, {
        serviceCode: key,
        serviceName: d.serviceName || '-',
        totalCount: 0,
        totalRevenuePL: 0
      });
    }
    const s = serviceSummary.get(key);
    s.totalCount += d.orderQty || 0;
    s.totalRevenuePL += d.revenuePL || 0;
  }

  // เรียงตาม Top รายได้
  state.sortedServiceSummary = Array.from(serviceSummary.values()).sort(
    (a, b) => b.totalRevenuePL - a.totalRevenuePL
  );

  const totalItems = state.sortedServiceSummary.length;
  const totalPages = Math.ceil(totalItems / state.servicePageSize);

  if (state.serviceDetailsPage * state.servicePageSize >= totalItems) {
    state.serviceDetailsPage = 0;
  }

  const start = state.serviceDetailsPage * state.servicePageSize;
  const pageRows = state.sortedServiceSummary.slice(
    start,
    start + state.servicePageSize
  );

  // -------- กราฟ 1: จำนวนครั้งการใช้งานแยกตามรหัสหัตถการ --------
  const data = new google.visualization.DataTable();
  data.addColumn('string', 'Service');
  data.addColumn('number', 'จำนวน (ครั้ง)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'รายได้ (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn({ type: 'string', role: 'tooltip' });

  // -------- กราฟ 2: รายได้แยกตามรหัสหัตถการ --------
  const dataRevenue = new google.visualization.DataTable();
  dataRevenue.addColumn('string', 'Service');
  dataRevenue.addColumn('number', 'รายได้ (P/L)');
  dataRevenue.addColumn({ type: 'string', role: 'style' });
  dataRevenue.addColumn('number', 'จำนวน (ครั้ง)');
  dataRevenue.addColumn({ type: 'string', role: 'style' });
  dataRevenue.addColumn({ type: 'string', role: 'tooltip' });

  for (const d of pageRows) {
    const label = d.serviceCode || '-';
    const count = d.totalCount;
    const revenue = d.totalRevenuePL;
    const tooltip =
      `หัตถการ: [${d.serviceCode}] ${d.serviceName}\n` +
      `จำนวน: ${count.toLocaleString()} ครั้ง\n` +
      `รายได้: ${formatShortNumber(revenue)} บาท`;

    const isSelected = d.serviceCode === serviceFilter;
    const opacity = !serviceFilter || isSelected ? '1.0' : '0.3';

    const countColor = isSelected ? COLORS.serviceSelected : COLORS.serviceCount;
    const revenueColor = isSelected ? COLORS.serviceSelected : COLORS.serviceRevenue;

    // กราฟจำนวนครั้ง (แท่ง = จำนวน, เส้น = รายได้)
    data.addRow([
      label,
      count,
      `color: ${countColor}; opacity: ${opacity};`,
      revenue,
      `color: ${revenueColor}; opacity: ${opacity};`,
      tooltip
    ]);

    // กราฟรายได้ (แท่ง = รายได้, เส้น = จำนวน)
    dataRevenue.addRow([
      label,
      revenue,
      `color: ${revenueColor}; opacity: ${opacity};`,
      count,
      `color: ${countColor}; opacity: ${opacity};`,
      tooltip
    ]);
  }

  const baseTitleSuffix = monthFilter
    ? `(เดือน ${monthFilter}${yearFilter ? ` / ปี ${yearFilter}` : ''})`
    : (yearFilter ? `(ปี ${yearFilter})` : '(รวม)');

  const optionsCount = {
    title: `จำนวนครั้งการใช้งานแยกตามรหัสหัตถการ ${baseTitleSuffix}`,
    legend: { position: 'bottom' },
    chartArea: { width: '85%', height: '65%' },
    backgroundColor: { fill: '#fff' },
    hAxis: { title: 'หัตถการ', slantedText: true, slantAngle: 45 },
    seriesType: 'bars',
    series: {
      0: { type: 'bars', targetAxisIndex: 0, color: COLORS.serviceCount },
      1: { type: 'line', targetAxisIndex: 1, color: COLORS.serviceRevenue }
    },
    vAxes: {
      0: { title: 'จำนวน (ครั้ง)', textStyle: { color: COLORS.serviceCount } },
      1: {
        title: 'รายได้ (P/L)',
        format: 'short',
        textStyle: { color: COLORS.serviceRevenue }
      }
    }
  };

  const optionsRevenue = {
    title: `รายได้แยกตามรหัสหัตถการ ${baseTitleSuffix}`,
    legend: { position: 'bottom' },
    chartArea: { width: '85%', height: '65%' },
    backgroundColor: { fill: '#fff' },
    hAxis: { title: 'หัตถการ', slantedText: true, slantAngle: 45 },
    seriesType: 'bars',
    series: {
      // แท่ง = รายได้ (ฟ้า), เส้น = จำนวน (เขียว)
      0: { type: 'bars', targetAxisIndex: 1, color: COLORS.serviceRevenue },
      1: { type: 'line', targetAxisIndex: 0, color: COLORS.serviceCount }
    },
    vAxes: {
      0: { title: 'จำนวน (ครั้ง)', textStyle: { color: COLORS.serviceCount } },
      1: {
        title: 'รายได้ (P/L)',
        format: 'short',
        textStyle: { color: COLORS.serviceRevenue }
      }
    }
  };

  // วาดกราฟจำนวนครั้ง
  if (!state.chartServiceDetails) {
    state.chartServiceDetails = new google.visualization.ComboChart(containerCount);
  }
  state.chartServiceDetails.draw(data, optionsCount);

  google.visualization.events.removeAllListeners(state.chartServiceDetails);
  google.visualization.events.addListener(state.chartServiceDetails, 'select', () => {
    const sel = state.chartServiceDetails.getSelection();
    if (!sel.length) return;

    const row = sel[0].row;
    if (row == null) return;

    const globalIndex = state.serviceDetailsPage * state.servicePageSize + row;
    const selected = state.sortedServiceSummary[globalIndex];
    if (!selected) return;

    const code = selected.serviceCode;
    state.currentServiceFilter =
      state.currentServiceFilter === code ? null : code;
    drawChartAndTable();
  });

  // วาดกราฟรายได้
  if (containerRevenue) {
    if (!state.chartServiceRevenue) {
      state.chartServiceRevenue = new google.visualization.ComboChart(containerRevenue);
    }
    state.chartServiceRevenue.draw(dataRevenue, optionsRevenue);

    google.visualization.events.removeAllListeners(state.chartServiceRevenue);
    google.visualization.events.addListener(state.chartServiceRevenue, 'select', () => {
      const sel = state.chartServiceRevenue.getSelection();
      if (!sel.length) return;

      const row = sel[0].row;
      if (row == null) return;

      const globalIndex = state.serviceDetailsPage * state.servicePageSize + row;
      const selected = state.sortedServiceSummary[globalIndex];
      if (!selected) return;

      const code = selected.serviceCode;
      state.currentServiceFilter =
        state.currentServiceFilter === code ? null : code;
      drawChartAndTable();
    });
  }

  // pagination UI ตามของเดิม
  const controls = $(CONFIG.domIds.servicePaginationControls);
  const btnPrev = $(CONFIG.domIds.btnPrevService);
  const btnNext = $(CONFIG.domIds.btnNextService);
  const indicator = $(CONFIG.domIds.servicePageIndicator);

  if (totalPages > 1) {
    controls.style.display = 'flex';
    btnPrev.disabled = state.serviceDetailsPage === 0;
    btnNext.disabled = state.serviceDetailsPage >= totalPages - 1;
    indicator.textContent = `หน้า ${state.serviceDetailsPage + 1} / ${totalPages}`;
  } else {
    controls.style.display = 'none';
  }
}

function changeServicePage(direction) {
  const totalItems = state.sortedServiceSummary.length;
  const totalPages = Math.ceil(totalItems / state.servicePageSize);

  const newPage = state.serviceDetailsPage + direction;
  if (newPage < 0 || newPage >= totalPages) return;

  state.serviceDetailsPage = newPage;
  drawServiceDetailsChart(
    state.currentAeTitle,
    state.currentMonthFilter,
    state.currentServiceFilter
  );
}
