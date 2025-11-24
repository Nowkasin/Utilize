// ui.js
// ฟังก์ชันจัดการ UI: dropdown, ปุ่ม, ข้อความสถานะ

// ใช้ debounce เวลาเปลี่ยน AE Title จะได้ไม่ยิง API ถี่เกินไป
let aeChangeDebounce = null;

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
    const brandModels = Object.keys(state.deviceHierarchy[state.currentBmeName]).sort();
    brandModelSelect.disabled = false;
    brandModels.forEach(bm => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = bm;
      brandModelSelect.appendChild(opt);
    });
  } else {
    brandModelSelect.disabled = true;
  }

  clearView();
}

function applyInitialSelectionFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const aeTitle = params.get('ae');
    if (!aeTitle) return; // ไม่มีค่าใน URL ก็ไม่ต้องทำอะไร

    const device = state.bmeMap[aeTitle];
    if (!device) {
      console.warn('[applyInitialSelectionFromUrl] unknown aeTitle in URL', aeTitle);
      return;
    }

    const bmeName = device.bmeName || 'Unknown';
    const brandModel = `${device.brand || 'N/A'} | ${device.model || 'N/A'}`;

    const bmeSelect = $(CONFIG.domIds.bmeSelect);
    const brandModelSelect = $(CONFIG.domIds.brandModelSelect);
    const aeSelect = $(CONFIG.domIds.aeSelect);

    // 1) เซ็ต dropdown ตัวที่ 1: BME
    bmeSelect.value = bmeName;
    handleBmeChange(); // จะไปเติม Brand/Model + เคลียร์ AE ให้

    // 2) เซ็ต dropdown ตัวที่ 2: Brand/Model
    brandModelSelect.value = brandModel;
    handleBrandModelChange(); // จะไปเติม AE Title ให้

    // 3) เซ็ต dropdown ตัวที่ 3: AE Title
    aeSelect.value = aeTitle;

    // sync state ให้ตรง
    state.currentBmeName = bmeName;
    state.currentBrandModel = brandModel;
    state.currentAeTitle = aeTitle;
    state.currentMonthFilter = null;
    state.currentServiceFilter = null;
    state.serviceDetailsPage = 0;

    // โหลดข้อมูลเครื่องนี้เลย (อย่าเรียก handleAeTitleChange เดี๋ยวจะ reload loop)
    loadDeviceData(aeTitle);
  } catch (e) {
    console.error('[applyInitialSelectionFromUrl] ERROR', e);
  }
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
  const aeTitle = aeSelect.value || null;

  // reset state filter ต่าง ๆ ก่อน
  state.currentAeTitle = aeTitle;
  state.currentMonthFilter = null;
  state.currentServiceFilter = null;
  state.serviceDetailsPage = 0;

  if (!aeTitle) {
    clearView();
    return;
  }

  // ใส่ aeTitle ลง query string แล้ว reload หน้า
  const url = new URL(window.location.href);
  url.searchParams.set('ae', aeTitle);  // เช่น ?ae=CT10099
  window.location.href = url.toString();
}


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


// init + bind events
function initDashboard() {
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

  google.charts.load('current', { packages: ['corechart'] });
  google.charts.setOnLoadCallback(loadInitialData);
}

// ท้ายไฟล์ ui.js
document.addEventListener('DOMContentLoaded', initDashboard);
