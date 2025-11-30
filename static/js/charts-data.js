// ส่วนการเตรียมข้อมูลเพื่อวาดกราฟ

// ---------------------- DATA AGGREGATION & HELPERS ---------------------- //

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

  const filteredPacs = Array.isArray(state.pacsDataDetails)
    ? state.pacsDataDetails.filter(
        d => d.aeTitle === aeTitle && (!serviceFilter || d.serviceCode === serviceFilter)
      )
    : [];

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

    const baseLineStyle = isFuture ? 'stroke-dasharray: 4 4; opacity: 0.2;' : '';
    const barStyle = isFuture ? `fill: ${COLORS.futureBarFill}; opacity: 0.5;` : null;

    const monthlyRevenuePL = isFuture ? 0 : (monthlyRevenueMap.get(yearMonth) || 0);
    cumRevenuePL += monthlyRevenuePL;

    // หา key ของ SAP ตาม orderNum + เดือน
    const sapKeyDash = `${orderNum}-${yearMonth}`;                      // เช่น 4500012345-2025-11
    const sapKeyCompact = `${orderNum}-${yearMonth.replace('-', '')}`;  // เช่น 4500012345-202511

    let monthlyExpenseSAP = 0;

    if (!isFuture) {
      if (sapMap.hasOwnProperty(sapKeyDash)) {
        monthlyExpenseSAP = sapMap[sapKeyDash] || 0;
      } else if (sapMap.hasOwnProperty(sapKeyCompact)) {
        monthlyExpenseSAP = sapMap[sapKeyCompact] || 0;
      } else {
        console.warn(
          '[aggregateDataForChart] ไม่พบค่า SAP สำหรับ key',
          sapKeyDash, 'หรือ', sapKeyCompact
        );
      }
    }

    cumExpenseSAP += monthlyExpenseSAP;

    let fixedDep = 0;
    const fixedCapEx = capEx;
    if (depCounter < depMonths) {
      fixedDep = !serviceFilter ? monthlyDep : 0;
      depCounter++;
    }

    // สีเส้นรายได้สะสม: ติดลบ=แดง, ต่ำกว่า CAPEX=ม่วง, สูงกว่า CAPEX=ฟ้า
    let revenueStyle = baseLineStyle;
    if (cumRevenuePL < 0) {
      revenueStyle += ' color: #DC2626;';        // แดง
    } else if (fixedCapEx && cumRevenuePL < fixedCapEx) {
      revenueStyle += ' color: #9333EA;';        // ม่วงใต้ CAPEX
    } else {
      revenueStyle += ' color: #1a73e8;';        // ฟ้าเหนือ CAPEX
    }
    if (!revenueStyle) revenueStyle = null;

    const expenseStyle = baseLineStyle || null;
    const capexStyle = baseLineStyle || null;
    const depStyle = baseLineStyle || null;

    rows.push([
      new Date(dateStr),          // 0 Date
      monthlyRevenuePL,           // 1 Monthly Revenue
      barStyle,                   // 2 style (revenue bar)
      cumRevenuePL,               // 3 Cum Revenue
      revenueStyle,               // 4 style (cum rev line)
      monthlyExpenseSAP,          // 5 Monthly Expense
      barStyle,                   // 6 style (expense bar)
      cumExpenseSAP,              // 7 Cum Expense
      expenseStyle,               // 8 style (cum exp line)
      fixedCapEx,                 // 9 CapEx
      capexStyle,                 //10 style (capex line)
      fixedDep,                   //11 Dep
      depStyle                    //12 style (dep line)
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

function initChartDateBounds(fullData) {
  if (!fullData || fullData.getNumberOfRows() === 0) return;

  if (state.chartDateAeTitle !== state.currentAeTitle) {
    state.chartDateAeTitle = state.currentAeTitle;
    state.chartDateWindow = null;
    state.chartDateBounds = null;
  }

  let min = null;
  let max = null;
  for (let i = 0; i < fullData.getNumberOfRows(); i++) {
    const d = fullData.getValue(i, 0);
    if (!(d instanceof Date)) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  if (!min || !max) return;

  state.chartDateBounds = { min, max };

  if (!state.chartDateWindow) {
    const range = getInitialDateRange(state.currentAeTitle);
    if (range) {
      const start = range.start < min ? min : range.start;
      const end = range.end > max ? max : range.end;
      state.chartDateWindow = { start, end };
    } else {
      state.chartDateWindow = { start: min, end: max };
    }
  }
}

function updateYearFilterUI(aeTitle) {
  const select = document.getElementById('year_filter_selector');
  if (!select) return;

  const allDetails = Array.isArray(state.pacsDataDetails)
    ? state.pacsDataDetails.filter(d => d.aeTitle === aeTitle)
    : [];

  const yearsSet = new Set();
  for (const d of allDetails) {
    if (!d.yearMonth) continue;
    yearsSet.add(d.yearMonth.substring(0, 4));
  }
  const years = Array.from(yearsSet).sort((a, b) => b.localeCompare(a)); // ปีล่าสุดอยู่บน

  const current = state.currentYearFilter || '';

  // rebuild options
  select.innerHTML = '';
  const optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = 'ทุกปี';
  select.appendChild(optAll);

  for (const y of years) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    select.appendChild(opt);
  }

  select.value = current;

  select.onchange = function () {
    const val = select.value;
    state.currentYearFilter = val || null;
    state.serviceDetailsPage = 0;
    drawServiceDetailsChart(
      state.currentAeTitle,
      state.currentMonthFilter,
      state.currentServiceFilter
    );
  };
}
