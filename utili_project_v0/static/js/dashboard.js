// dashboard.js

// ---------------------- CONFIG / CONSTANTS ---------------------- //
const CONFIG = {
  api: {
    initialData: '/api/initial-data',
    deviceData: aeTitle => `/api/device-data/${encodeURIComponent(aeTitle)}`
  },
  domIds: {
    bmeSelect: 'bmeNameSelector',
    brandModelSelect: 'brandModelSelector',
    aeSelect: 'aeTitleSelector',
    chartTitle: 'chartTitle',
    chartMonthly: 'chart_div_monthly',
    chartCumulative: 'chart_div_cumulative',
    chartServiceDetails: 'chart_div_service_details',
    filterStatus: 'filter_status',
    btnPrevService: 'btn_prev_service',
    btnNextService: 'btn_next_service',
    servicePaginationControls: 'service_pagination_controls',
    servicePageIndicator: 'service_page_indicator'
  }
};

const COLORS = {
  revenueMonthly: '#10B981',
  expenseMonthly: '#F59E0B',
  depreciation: '#6B7280',
  revenueCumulative: '#1a73e8',
  expenseCumulative: '#F59E0B',
  capex: '#6B7280',
  futureBarFill: '#CCCCCC',
  serviceCount: '#10B981',
  serviceRevenue: '#1a73e8',
  serviceSelected: '#3b82f6'
};

const TEXTS = {
  selectAllThree: 'โปรดเลือกเครื่องมือแพทย์ให้ครบ 3 ขั้นตอน',
  selectDevice: 'โปรดเลือกเครื่องมือแพทย์',
  loadingDevice: 'กำลังโหลดข้อมูลเครื่อง...',
  noServiceData: 'ไม่พบข้อมูลหัตถการ',
  genericErrorTitle: 'เกิดข้อผิดพลาด',
  filterHint: 'คลิกที่กราฟรายเดือน (เดือน) หรือกราฟหัตถการ (Service) เพื่อกรองข้อมูล'
};

// ---------------------- STATE ---------------------- //
const state = {
  // data
  bmeMap: {},
  deviceHierarchy: {},
  sapMap: {},
  pacsDataDetails: [],
  allUniqueDates: [],
  todayStr: null,

  // current selection / filters
  currentBmeName: null,
  currentBrandModel: null,
  currentAeTitle: null,
  currentMonthFilter: null,
  currentServiceFilter: null,

  // charts
  chartMonthly: null,
  chartCumulative: null,
  chartServiceDetails: null,

  // service summary + pagination
  sortedServiceSummary: [],
  serviceDetailsPage: 0,
  servicePageSize: 5
};

// ---------------------- UTILITIES ---------------------- //
const $ = id => document.getElementById(id);

const formatShortNumber = num => {
  if (!num) return '0';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
};

const buildSpinnerHtml = message => `
  <div class="loading-container">
    <div class="spinner"></div>
    <p class="text-lg text-gray-600 mt-4">${message}</p>
  </div>
`;

const buildPlaceholderHtml = message => `
  <div class="loading-container">
    <div class="text-xl text-gray-500">${message}</div>
  </div>
`;

const buildErrorHtml = error => `
  <div class="loading-container" style="height:100%;">
    <div class="text-xl text-red-600 font-bold">${TEXTS.genericErrorTitle}</div>
    <p class="text-gray-700 mt-2 p-4">${String(error)}</p>
  </div>
`;

// ---------------------- INIT ---------------------- //
function initDashboard() {
  // ผูก event ของ dropdown / ปุ่ม pagination
  const bmeSelect = $(CONFIG.domIds.bmeSelect);
  const brandModelSelect = $(CONFIG.domIds.brandModelSelect);
  const aeSelect = $(CONFIG.domIds.aeSelect);
  const btnPrev = $(CONFIG.domIds.btnPrevService);
  const btnNext = $(CONFIG.domIds.btnNextService);

  if (!bmeSelect || !brandModelSelect || !aeSelect) {
    console.error('DOM element not found. Check IDs in index.html');
    return;
  }

  bmeSelect.addEventListener('change', handleBmeChange);
  brandModelSelect.addEventListener('change', handleBrandModelChange);
  aeSelect.addEventListener('change', handleAeTitleChange);

  if (btnPrev && btnNext) {
    btnPrev.addEventListener('click', () => changeServicePage(-1));
    btnNext.addEventListener('click', () => changeServicePage(1));
  }

  // โหลด Google Charts แล้วค่อยโหลด data
  google.charts.load('current', { packages: ['corechart'] });
  google.charts.setOnLoadCallback(loadInitialData);
}

// ---------------------- DATA LOADING ---------------------- //
async function safeFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} : ${response.statusText}`);
  }
  return response.json();
}

async function loadInitialData() {
  try {
    const dataObject = await safeFetchJson(CONFIG.api.initialData);

    if (dataObject.error) {
      throw new Error(dataObject.error);
    }

    state.bmeMap = dataObject.bmeMap || {};

    // แปลง installDate
    Object.values(state.bmeMap).forEach(device => {
      if (device.installDate) {
        device.installDate = new Date(device.installDate);
      }
    });

    // สร้าง hierarchy
    state.deviceHierarchy = Object.entries(state.bmeMap).reduce(
      (acc, [ae, dev]) => {
        const bme = dev.bmeName || 'Unknown';
        const brandModel = `${dev.brand || 'N/A'} | ${dev.model || 'N/A'}`;
        if (!acc[bme]) acc[bme] = {};
        if (!acc[bme][brandModel]) acc[bme][brandModel] = [];
        acc[bme][brandModel].push(ae);
        return acc;
      },
      {}
    );

    populateBmeDropdown();
    clearView();
  } catch (err) {
    showError(err);
  }
}

async function loadDeviceData(aeTitle) {
  try {
    showLoadingSpinner();

    const data = await safeFetchJson(CONFIG.api.deviceData(aeTitle));
    if (data.error) {
      throw new Error(data.error);
    }

    state.sapMap = data.sapMap || {};
    state.pacsDataDetails = data.pacsDataDetails || [];
    state.allUniqueDates = data.allUniqueDates || [];
    state.todayStr = data.todayStr || null;

    drawChartAndTable();
  } catch (err) {
    showError(err);
  }
}

// ---------------------- DROPDOWN HANDLERS ---------------------- //
function populateBmeDropdown() {
  const bmeSelect = $(CONFIG.domIds.bmeSelect);
  const brandModelSelect = $(CONFIG.domIds.brandModelSelect);
  const aeSelect = $(CONFIG.domIds.aeSelect);

  const bmeNames = Object.keys(state.deviceHierarchy).sort();

  if (!bmeNames.length) {
    bmeSelect.innerHTML = '<option value="">ไม่พบเครื่องมือแพทย์</option>';
    showError('ไม่พบข้อมูล AE Title');
    return;
  }

  bmeSelect.innerHTML = '<option value="">-- 1. เลือกชื่อเครื่อง --</option>';
  bmeNames.forEach(bme => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = bme;
    bmeSelect.appendChild(opt);
  });

  brandModelSelect.innerHTML = '<option value="">-- 2. เลือก Brand/Model --</option>';
  aeSelect.innerHTML = '<option value="">-- 3. เลือก AE Title --</option>';
  brandModelSelect.disabled = true;
  aeSelect.disabled = true;
}

function handleBmeChange() {
  const bmeSelect = $(CONFIG.domIds.bmeSelect);
  const brandModelSelect = $(CONFIG.domIds.brandModelSelect);
  const aeSelect = $(CONFIG.domIds.aeSelect);

  state.currentBmeName = bmeSelect.value || null;
  state.currentBrandModel = null;
  state.currentAeTitle = null;

  brandModelSelect.innerHTML = '<option value="">-- 2. เลือก Brand/Model --</option>';
  aeSelect.innerHTML = '<option value="">-- 3. เลือก AE Title --</option>';
  aeSelect.disabled = true;

  if (state.currentBmeName && state.deviceHierarchy[state.currentBmeName]) {
    brandModelSelect.disabled = true;
    const brandModels = Object.keys(state.deviceHierarchy[state.currentBmeName]).sort();
    brandModels.forEach(bm => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = bm;
      brandModelSelect.appendChild(opt);
    });
    brandModelSelect.disabled = false;
  } else {
    brandModelSelect.disabled = true;
  }

  clearView();
}

function handleBrandModelChange() {
  const brandModelSelect = $(CONFIG.domIds.brandModelSelect);
  const aeSelect = $(CONFIG.domIds.aeSelect);

  state.currentBrandModel = brandModelSelect.value || null;
  state.currentAeTitle = null;

  aeSelect.innerHTML = '<option value="">-- 3. เลือก AE Title --</option>';

  const list = state.deviceHierarchy[state.currentBmeName]?.[state.currentBrandModel];
  if (list && list.length) {
    aeSelect.disabled = false;
    list.forEach(ae => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = ae;
      aeSelect.appendChild(opt);
    });
  } else {
    aeSelect.disabled = true;
  }

  clearView();
}

function handleAeTitleChange() {
  const aeSelect = $(CONFIG.domIds.aeSelect);
  state.currentAeTitle = aeSelect.value || null;
  state.currentMonthFilter = null;
  state.currentServiceFilter = null;
  state.serviceDetailsPage = 0;

  if (!state.currentAeTitle) {
    clearView();
    return;
  }

  loadDeviceData(state.currentAeTitle);
}

// ---------------------- VIEW / ERROR ---------------------- //
function clearView() {
  const placeholder = buildPlaceholderHtml(TEXTS.selectAllThree);
  $(CONFIG.domIds.chartCumulative).innerHTML = placeholder;
  $(CONFIG.domIds.chartMonthly).innerHTML = placeholder;
  $(CONFIG.domIds.chartServiceDetails).innerHTML = placeholder;

  $(CONFIG.domIds.chartTitle).textContent = TEXTS.selectAllThree;

  state.currentMonthFilter = null;
  state.currentServiceFilter = null;
  updateFilterStatus();
}

function showLoadingSpinner() {
  const spinner = buildSpinnerHtml(TEXTS.loadingDevice);
  $(CONFIG.domIds.chartCumulative).innerHTML = spinner;
  $(CONFIG.domIds.chartMonthly).innerHTML = spinner;
  $(CONFIG.domIds.chartServiceDetails).innerHTML =
    `<div style="height:800px;">${spinner}</div>`;
}

function showError(error) {
  console.error('Dashboard Error:', error);
  const html = buildErrorHtml(error);
  try {
    $(CONFIG.domIds.chartCumulative).innerHTML = html;
    $(CONFIG.domIds.chartMonthly).innerHTML = html;
    $(CONFIG.domIds.chartServiceDetails).innerHTML = html;
  } catch (e) {
    console.error('Could not display error in UI', e);
  }
}

// ---------------------- DATA AGGREGATION ---------------------- //
function aggregateDataForChart(aeTitle, serviceFilter) {
  const device = state.bmeMap[aeTitle];
  if (!device) return [];

  const { capEx, monthlyDep, depMonths, orderNum } = device;

  const filteredPacs = state.pacsDataDetails.filter(
    d => d.aeTitle === aeTitle && (!serviceFilter || d.serviceCode === serviceFilter)
  );

  const monthlyRevenueMap = new Map();
  for (const item of filteredPacs) {
    const ym = item.yearMonth;
    monthlyRevenueMap.set(ym, (monthlyRevenueMap.get(ym) || 0) + item.revenuePL);
  }

  let cumRevenuePL = 0;
  let cumExpenseSAP = 0;
  let depCounter = 0;
  const rows = [];

  for (const dateStr of state.allUniqueDates) {
    const yearMonth = dateStr.substring(0, 7);
    const isFuture = state.todayStr && dateStr > state.todayStr;

    const lineStyle = isFuture ? 'stroke-dasharray: 4 4; opacity: 0.2;' : null;
    const barStyle = isFuture ? `fill: ${COLORS.futureBarFill}; opacity: 0.5;` : null;

    const monthlyRevenuePL = isFuture ? 0 : (monthlyRevenueMap.get(yearMonth) || 0);
    cumRevenuePL += monthlyRevenuePL;

    const sapKey = `${orderNum}-${yearMonth}`;
    const monthlyExpenseSAP =
      isFuture || serviceFilter ? 0 : (state.sapMap[sapKey] || 0);
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
      barStyle,                   // 2 style
      cumRevenuePL,               // 3 Cum Revenue
      lineStyle,                  // 4 style
      monthlyExpenseSAP,          // 5 Monthly Expense
      barStyle,                   // 6 style
      cumExpenseSAP,              // 7 Cum Expense
      lineStyle,                  // 8 style
      fixedCapEx,                 // 9 CapEx
      lineStyle,                  //10 style
      fixedDep,                   //11 Dep
      lineStyle                   //12 style
    ]);
  }

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
  if (!state.currentAeTitle) return;

  const displayTitle = `${state.currentBmeName} [${state.currentBrandModel}] (${state.currentAeTitle})`;
  $(CONFIG.domIds.chartTitle).textContent =
    `แสดงกราฟวิเคราะห์สำหรับ: ${displayTitle}`;

  const seriesData = aggregateDataForChart(
    state.currentAeTitle,
    state.currentServiceFilter
  );
  if (!seriesData?.length) {
    showError('ไม่พบข้อมูล');
    return;
  }

  const data = new google.visualization.DataTable();
  data.addColumn('date', 'Date');
  data.addColumn('number', 'Monthly Revenue (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn('number', 'Cumulative Revenue (P/L)');
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

  drawMonthlyChart(data, displayTitle);
  drawCumulativeChart(data, displayTitle);
  drawServiceDetailsChart(state.currentAeTitle, state.currentMonthFilter, state.currentServiceFilter);
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
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    state.currentMonthFilter = state.currentMonthFilter === ym ? null : ym;
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
    const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    state.currentMonthFilter = state.currentMonthFilter === ym ? null : ym;
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
  data.addColumn('number', 'รายได้ (P/L)');
  data.addColumn({ type: 'string', role: 'style' });
  data.addColumn({ type: 'string', role: 'tooltip' });

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
        title: 'รายได้ (P/L)',
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

  // update pagination UI
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

// ---------------------- FILTER STATUS / CLEAR FILTERS ---------------------- //
function updateFilterStatus() {
  const el = $(CONFIG.domIds.filterStatus);
  let text = '';

  if (state.currentMonthFilter) {
    text += `<span class="filter-active p-1 rounded-md">เดือน: <strong>${state.currentMonthFilter}</strong></span> | `;
  }
  if (state.currentServiceFilter) {
    text += `<span class="filter-active p-1 rounded-md">Service: <strong>${state.currentServiceFilter}</strong></span>`;
  }

  const clearBtn =
    state.currentMonthFilter || state.currentServiceFilter
      ? ' <button class="ml-2 text-xs text-red-600 hover:underline font-semibold" type="button" onclick="clearAllFilters()"> (ล้างตัวกรอง) </button>'
      : '';

  if (!text) {
    el.innerHTML =
      `<p class="text-sm text-gray-500 italic">${TEXTS.filterHint}</p>` + clearBtn;
  } else {
    el.innerHTML = text + clearBtn;
  }
}

function clearAllFilters() {
  state.currentMonthFilter = null;
  state.currentServiceFilter = null;
  state.serviceDetailsPage = 0;

  state.chartMonthly?.setSelection([]);
  state.chartCumulative?.setSelection([]);
  state.chartServiceDetails?.setSelection?.([]);

  drawChartAndTable();
}

// ---------------------- PAGINATION ---------------------- //
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

// ---------------------- BOOTSTRAP ---------------------- //
// ให้เริ่มทำงานเมื่อ DOM พร้อม
document.addEventListener('DOMContentLoaded', initDashboard);
