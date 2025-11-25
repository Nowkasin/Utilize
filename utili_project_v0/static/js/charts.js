// charts.js
// ฟังก์ชันเกี่ยวกับการรวมข้อมูล และวาดกราฟทั้งหมด

// ---------------------- DATA AGGREGATION ---------------------- //
function aggregateDataForChart(aeTitle, serviceFilter) {
  const device = state.bmeMap[aeTitle];
  if (!device) {
    console.error('[aggregateDataForChart] ไม่พบ device ใน bmeMap สำหรับ', aeTitle);
    return [];
  }

  if (!Array.isArray(state.allUniqueDates) || state.allUniqueDates.length === 0) {
    console.error('[aggregateDataForChart] allUniqueDates ว่างหรือไม่ใช่ array', state.allUniqueDates);
    return [];
  }

  const { capEx, monthlyDep, depMonths, orderNum } = device;

  // filter PACS ตาม aeTitle + serviceFilter (ถ้ามี)
  const filteredPacs = Array.isArray(state.pacsDataDetails)
    ? state.pacsDataDetails.filter(
        d => d.aeTitle === aeTitle && (!serviceFilter || d.serviceCode === serviceFilter)
      )
    : [];

  // รวมรายได้ P/L เป็นรายเดือน
  const monthlyRevenueMap = new Map();
  for (const item of filteredPacs) {
    const ym = item.yearMonth;
    if (!ym) continue;
    monthlyRevenueMap.set(ym, (monthlyRevenueMap.get(ym) || 0) + (item.revenuePL || 0));
  }

  let cumRevenuePL = 0;
  let cumExpenseSAP = 0;
  let depCounter = 0;
  const rows = [];

  const sapMap = state.sapMap || {};
  const todayStr = state.todayStr || null;

  for (const dateStr of state.allUniqueDates) {
    const yearMonth = dateStr.substring(0, 7);
    const isFuture = todayStr && dateStr > todayStr;

    const lineStyle = isFuture ? 'stroke-dasharray: 4 4; opacity: 0.2;' : null;
    const barStyle = isFuture ? `fill: ${COLORS.futureBarFill}; opacity: 0.5;` : null;

    const monthlyRevenuePL = isFuture ? 0 : (monthlyRevenueMap.get(yearMonth) || 0);
    cumRevenuePL += monthlyRevenuePL;

    const sapKey = `${orderNum}-${yearMonth}`;
    const monthlyExpenseSAP =
      isFuture || serviceFilter ? 0 : (sapMap[sapKey] || 0);
    cumExpenseSAP += monthlyExpenseSAP;

    let fixedDep = 0;
    const fixedCapEx = capEx;
    if (depCounter < depMonths) {
      fixedDep = !serviceFilter ? monthlyDep : 0;
      depCounter++;
    }

    rows.push([
      new Date(dateStr),          // 0 Date
      monthlyRevenuePL,           // 1 Monthly Revenue
      barStyle,                   // 2 style (revenue bar)
      cumRevenuePL,               // 3 Cum Revenue
      lineStyle,                  // 4 style (cum rev line)
      monthlyExpenseSAP,          // 5 Monthly Expense
      barStyle,                   // 6 style (expense bar)
      cumExpenseSAP,              // 7 Cum Expense
      lineStyle,                  // 8 style (cum exp line)
      fixedCapEx,                 // 9 CapEx
      lineStyle,                  //10 style (capex line)
      fixedDep,                   //11 Dep
      lineStyle                   //12 style (dep line)
    ]);
  }

  console.log('[aggregateDataForChart] rows length', rows.length);
  return rows;
}


function getInitialDateRange(aeTitle) {
  const device = state.bmeMap[aeTitle];
  if (!device?.installDate) return null;

  const start = new Date(device.installDate);
  const end = new Date(start);
  end.setFullYear(start.getFullYear() + 3);
  return { start, end };
}

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
  // ใช้กำไร/ขาดทุนต่อเดือน
  data.addColumn('number', 'Monthly Profit (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  // ใช้กำไร/ขาดทุนสะสม
  data.addColumn('number', 'Cumulative Profit (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'Monthly Expense (SAP)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'Cumulative Expense (SAP)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'CAPEX (Break-Even)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'Monthly Depreciation');
  data.addColumn({ type: 'string', role: 'style' });

  data.addRows(seriesData);

  // เผื่อมีอะไรพังในแต่ละ chart → log ให้เห็นชัด ๆ
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
  const range = getInitialDateRange(state.currentAeTitle);
  const view = new google.visualization.DataView(fullData);
  view.setColumns([0, 3, 4, 7, 8, 9, 10]);

  const options = {
    title: `สะสม: ${displayTitle}`,
    legend: { position: 'bottom' },
    chartArea: { width: '85%', height: '70%' },
    backgroundColor: { fill: '#fff' },
    vAxis: { title: 'จำนวนเงิน (บาท)', format: 'short' },
    hAxis: {
      title: 'วันที่',
      format: 'MMM yyyy',
      viewWindow: range ? { min: range.start, max: range.end } : undefined
    },
    seriesType: 'line',
    series: {
      0: { color: COLORS.revenueCumulative, lineWidth: 2, pointSize: 5 },
      1: { color: COLORS.expenseCumulative, lineWidth: 2, pointSize: 5 },
      2: {
        color: COLORS.capex,
        lineWidth: 2,
        lineDashStyle: [4, 4],
        pointSize: 0
      }
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
  const container = $(CONFIG.domIds.chartServiceDetails);
  const filtered = state.pacsDataDetails.filter(
    d => d.aeTitle === aeTitle && (!monthFilter || d.yearMonth === monthFilter)
  );

  if (!filtered.length) {
    container.innerHTML = buildPlaceholderHtml(TEXTS.noServiceData);
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

    const data = new google.visualization.DataTable();
  data.addColumn('string', 'Service');
  data.addColumn('number', 'จำนวน (ครั้ง)');
  data.addColumn({ type: 'string', role: 'style' });
  // กราฟแกนขวาให้แสดงกำไร/ขาดทุน
  data.addColumn('number', 'กำไร (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn({ type: 'string', role: 'tooltip' });


  for (const d of pageRows) {
    const label = d.serviceCode || '-';
    const count = d.totalCount;
    const revenue = d.totalRevenuePL;
        const tooltip =
      `หัตถการ: [${d.serviceCode}] ${d.serviceName}\n` +
      `จำนวน: ${count.toLocaleString()} ครั้ง\n` +
      `กำไร/ขาดทุน: ${formatShortNumber(revenue)} บาท`;

    const isSelected = d.serviceCode === serviceFilter;
    const opacity = !serviceFilter || isSelected ? '1.0' : '0.3';

    const countColor = isSelected ? COLORS.serviceSelected : COLORS.serviceCount;
    const revenueColor = isSelected ? COLORS.serviceSelected : COLORS.serviceRevenue;

    data.addRow([
      label,
      count,
      `color: ${countColor}; opacity: ${opacity};`,
      revenue,
      `color: ${revenueColor}; opacity: ${opacity};`,
      tooltip
    ]);
  }

  const options = {
    title: `รายละเอียดหัตถการ ${monthFilter ? `(เดือน ${monthFilter})` : '(รวม)'}`,
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
        title: 'กำไร (P/L)',
        format: 'short',
        textStyle: { color: COLORS.serviceRevenue }
      }
    }

  };

  if (!state.chartServiceDetails) {
    state.chartServiceDetails = new google.visualization.ComboChart(container);
  }

  state.chartServiceDetails.draw(data, options);

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

  // pagination UI
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
