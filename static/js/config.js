// config.js
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
