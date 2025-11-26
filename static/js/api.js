// api.js
// ฟังก์ชันสำหรับคุยกับ backend (initial-data + device-data)

// ---------------------- FETCH HELPER ---------------------- //

/**
 *
 * @param {string} url
 * @param {object} options  - { timeoutMs?: number }
 * @returns {Promise<any>}
 */
async function safeFetchJson(url, options = {}) {
  const { timeoutMs } = options || {};

  let controller = null;
  let timerId = null;

  // ถ้ามีการกำหนด timeout และ browser รองรับ AbortController
  if (timeoutMs && typeof AbortController !== 'undefined') {
    controller = new AbortController();
    timerId = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  let response;
  try {
    response = await fetch(url, controller ? { signal: controller.signal } : undefined);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('การเชื่อมต่อเกินเวลาที่กำหนด (timeout)');
    }
    // network error อื่น ๆ
    throw err;
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }

  // อ่านเป็น text ก่อน เผื่อ backend ส่ง error เป็น text ธรรมดา/HTML
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    // ถ้า parse ไม่ได้ → ปล่อย data = null ไป แล้วจัดการต่อด้านล่าง
  }

  if (!response.ok) {
    // ถ้า backend ส่ง { "error": "ข้อความ..." } มา ให้ใช้ข้อความนั้นเลย
    if (data && data.error) {
      throw new Error(data.error);
    }
    // ถ้าไม่มี field error ก็ใช้ status ปกติ
    throw new Error(`HTTP ${response.status} : ${response.statusText}`);
  }

  return data;
}

// ---------------------- INITIAL DATA (DROPDOWN) ---------------------- //

async function loadInitialData() {
  try {
    console.log('[loadInitialData] fetching', CONFIG.api.initialData);
    const dataObject = await safeFetchJson(CONFIG.api.initialData, {
      timeoutMs: 30000,
    });

    if (dataObject && dataObject.error) {
      throw new Error(dataObject.error);
    }

    state.bmeMap = (dataObject && dataObject.bmeMap) || {};
    console.log('[loadInitialData] bmeMap keys', Object.keys(state.bmeMap).length);

    Object.values(state.bmeMap).forEach(device => {
      if (device.installDate) {
        device.installDate = new Date(device.installDate);
      }
    });

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

    // ⭐ ส่วนสำคัญ: ถ้ามีฟังก์ชัน applyInitialSelectionFromUrl ให้เรียกเลย
    if (typeof applyInitialSelectionFromUrl === 'function') {
      applyInitialSelectionFromUrl();
    }
  } catch (err) {
    console.error('[loadInitialData] ERROR', err);
    showError(err);
  }
}


// ใช้กัน response เก่าทับ response ใหม่ ถ้า user เปลี่ยน AE ไว ๆ
let activeDeviceRequestId = 0;

async function loadDeviceData(aeTitle) {
  if (!aeTitle) {
    console.warn('[loadDeviceData] called with empty aeTitle, skip');
    return;
  }

  const requestId = ++activeDeviceRequestId;
  console.log('[loadDeviceData] start for', aeTitle, 'req', requestId);

  // แสดง spinner ทันที
  showLoadingSpinner();

  try {
    const url = CONFIG.api.deviceData(aeTitle);
    console.log('[loadDeviceData] fetching', url, 'req', requestId);

    const data = await safeFetchJson(url, { timeoutMs: 30000 });
    console.log('[loadDeviceData] response', data, 'req', requestId);

    // ถ้า user เปลี่ยน AE ระหว่างที่ request นี้กำลังรอ → ทิ้งผลลัพธ์นี้ไป
    if (requestId !== activeDeviceRequestId) {
      console.log('[loadDeviceData] stale response ignored for', aeTitle, 'req', requestId);
      return;
    }

    if (!data || typeof data !== 'object') {
      throw new Error('รูปแบบข้อมูลจาก API /api/device-data ไม่ถูกต้อง');
    }
    if (data.error) {
      throw new Error(data.error);
    }

    // เซ็ต state จาก backend
    state.sapMap = data.sapMap || {};
    state.pacsDataDetails = Array.isArray(data.pacsDataDetails)
      ? data.pacsDataDetails
      : [];
    state.allUniqueDates = Array.isArray(data.allUniqueDates)
      ? data.allUniqueDates
      : [];
    state.todayStr = data.todayStr || null;

    // ข้อมูล device (capEx, depMonths, installDate ฯลฯ)
    state.deviceInfo = data.deviceInfo || null;

    console.log('[loadDeviceData] state after set', {
      aeTitle,
      sapKeys: Object.keys(state.sapMap || {}).length,
      pacsRows: (state.pacsDataDetails || []).length,
      dates: (state.allUniqueDates || []).length,
      todayStr: state.todayStr,
    });

    // ยืนยันให้ currentAeTitle ตรงกับตัวที่โหลดอยู่
    state.currentAeTitle = aeTitle;

    // วาดกราฟทั้งหมด (จะเขียนทับ spinner)
    drawChartAndTable();
  } catch (err) {
    console.error('[loadDeviceData] ERROR', err, 'req', requestId);

    // ถ้า error นี้เป็นของ request เก่า → ไม่ต้องรบกวน UI ปัจจุบัน
    if (requestId !== activeDeviceRequestId) {
      console.log('[loadDeviceData] error from stale request, ignore UI update');
      return;
    }

    // กันกรณี showError พังเอง
    try {
      showError(err);
    } catch (e2) {
      console.error('[loadDeviceData] showError FAILED', e2);
      ['chartCumulative', 'chartMonthly', 'chartServiceDetails'].forEach(key => {
        const el = $(CONFIG.domIds[key]);
        if (el) {
          el.innerHTML =
            '<div style="padding:1rem;color:red;">เกิดข้อผิดพลาดในการโหลดข้อมูล</div>';
        }
      });
    }
  }
}
