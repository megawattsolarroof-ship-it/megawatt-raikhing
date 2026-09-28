/* Attendance recovery. No background submission and no biometric data in diagnostics. */
(function (global) {
  'use strict';
  const VERSION = '20260928-r1';
  const started = new Date().toISOString();
  const events = [];
  const storeKey = 'attendance.pending.v1:' + location.pathname;
  let memoryPending = null;
  function read() {
    try { memoryPending = JSON.parse(sessionStorage.getItem(storeKey)) || memoryPending; } catch (_) {}
    return memoryPending;
  }
  function write(value) {
    memoryPending = value;
    try { if (value) sessionStorage.setItem(storeKey, JSON.stringify(value)); else sessionStorage.removeItem(storeKey); } catch (_) {}
  }
  function record(stage, detail) {
    events.push({ at: new Date().toISOString(), stage, detail: String(detail || '').slice(0, 300) });
    if (events.length > 40) events.shift();
  }
  function report() {
    return {
      kind: 'รายงานเหตุขัดข้อง — ยังไม่ใช่หลักฐานลงเวลาสำเร็จ', version: VERSION,
      website: location.origin + location.pathname, openedAtDeviceTime: started,
      reportedAtDeviceTime: new Date().toISOString(),
      timeSource: 'นาฬิกาอุปกรณ์ ต้องให้ผู้ดูแลตรวจสอบ',
      browser: navigator.userAgent, online: navigator.onLine,
      pendingRequest: read() ? { id: read().id, createdAt: read().createdAt, state: 'ยังไม่ได้รับคำยืนยัน' } : null,
      events: events.slice()
    };
  }
  function showHelp(message) {
    record('help', message);
    const panel = document.getElementById('attendanceHelp');
    if (panel) {
      panel.open = true;
      panel.querySelector('[data-recovery-message]').textContent = message || 'กรุณาส่งรายงานนี้ให้ผู้ดูแลตรวจสอบเวลา';
    }
  }
  function mount() {
    const panel = document.createElement('details');
    panel.id = 'attendanceHelp';
    panel.style.cssText = 'max-width:540px;margin:16px auto;padding:12px;border:1px solid currentColor;border-radius:12px;font:inherit;text-align:left';
    panel.innerHTML = '<summary>สแกนไม่ได้ / ตรวจสอบรายการที่ยังไม่ยืนยัน</summary>' +
      '<p data-recovery-message>หากกล้องไม่ขึ้น ให้เปิดลิงก์ใน Safari หรือ Chrome อนุญาตกล้องและตำแหน่ง แล้วลองอีกครั้ง</p>' +
      '<p>หากยังไม่ได้ ให้ดาวน์โหลดรายงานและแจ้งหัวหน้างานทันที รายงานนี้ใช้ประกอบการตรวจสอบ ไม่ใช่การลงเวลาสำเร็จ</p>' +
      '<button type="button" data-download>ดาวน์โหลดรายงานเหตุขัดข้อง</button> ' +
      '<a href="index.html">ตรวจตารางลงเวลา</a>' +
      '<p><button type="button" data-clear>ผู้ดูแลตรวจรายการค้างแล้ว / เริ่มรายการใหม่</button></p>';
    (document.querySelector('.page-wrap') || document.querySelector('main') || document.body).appendChild(panel);
    panel.querySelector('[data-download]').onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'attendance-issue-' + Date.now() + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    panel.querySelector('[data-clear]').onclick = () => {
      if (confirm('ตรวจตารางและให้ผู้ดูแลตรวจสอบแล้วใช่ไหม? หากรายการเดิมสำเร็จ การสแกนใหม่อาจเป็นเวลาออกงาน')) {
        write(null); record('pending-cleared-by-user'); location.reload();
      }
    };
    if (read()) showHelp('มีรายการที่ยังไม่ได้รับคำยืนยัน กรุณาตรวจตารางก่อนเริ่มรายการใหม่');
  }
  function begin(body, endpoint, safeRetry) {
    const old = read();
    if (old) {
      if (!safeRetry || Date.now() - Date.parse(old.createdAt) > 3600000 || old.endpoint !== endpoint || old.name !== body.name || old.target !== (body.site || body.sheetTarget || body.mode || '')) {
        showHelp('มีรายการค้างที่ต้องตรวจสอบก่อน เพื่อป้องกันการลงเวลาซ้ำ');
        throw new Error('กรุณาตรวจรายการค้างในตารางหรือให้ผู้ดูแลตรวจสอบก่อน');
      }
      return old;
    }
    const payload = {};
    for (const field of ['action', 'site', 'sheetTarget', 'mode', 'name', 'lat', 'lng', 'note']) if (body[field] !== undefined) payload[field] = body[field];
    const value = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
      createdAt: new Date().toISOString(), name: body.name, target: body.site || body.sheetTarget || body.mode || '', endpoint, payload };
    write(value); record('save-start'); return value;
  }
  async function send(fetcher, endpoint, body, safeRetry) {
    const pending = begin(body, endpoint, safeRetry);
    const controller = new AbortController(); let timer;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetcher(endpoint, { method: 'POST', signal: controller.signal, body: JSON.stringify({ ...body, ...pending.payload, requestId: pending.id }) });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          if (data.error || data.status === 'error') {
            // Only explicit validation/busy responses prove a write was not attempted.
            if (['bad_request', 'unauthorized', 'busy', 'request_conflict'].includes(data.error)) write(null);
            throw new Error(data.message || data.error);
          }
          if (!(data.message || data.status === 'success' || data.success === true)) throw new Error('คำตอบไม่ได้ยืนยันการบันทึก');
          return data;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ยังไม่ได้รับคำยืนยันภายใน 20 วินาที กรุณาตรวจตารางก่อนสแกนซ้ำ')), 20000); })
      ]);
      write(null); record('save-confirmed'); return result;
    } catch (error) {
      showHelp('ยังไม่ยืนยันผลการบันทึก: ' + error.message); throw error;
    } finally { clearTimeout(timer); controller.abort(); }
  }
  global.AttendanceRecovery = { VERSION, record, report, showHelp, begin, send, pending: read, complete: () => write(null) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})(window);
