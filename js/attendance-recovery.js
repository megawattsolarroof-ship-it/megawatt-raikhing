/* Attendance recovery. No background submission and no biometric data in diagnostics. */
(function (global) {
  'use strict';
  const VERSION = '20260928-r3';
  const started = new Date().toISOString();
  const events = [];
  const storeKey = 'attendance.pending.v1:' + location.pathname;
  const eventKey = 'attendance.events.v1:' + location.pathname;
  try {
    const previous = JSON.parse(sessionStorage.getItem(eventKey));
    if (Array.isArray(previous)) events.push(...previous.filter(event => event && typeof event.stage === 'string').slice(-39));
  } catch (_) {}
  let memoryPending = null;
  function read() {
    try { memoryPending = JSON.parse(sessionStorage.getItem(storeKey)) || memoryPending; } catch (_) {}
    return memoryPending;
  }
  function write(value) {
    memoryPending = value;
    try { if (value) sessionStorage.setItem(storeKey, JSON.stringify(value)); else sessionStorage.removeItem(storeKey); } catch (_) {}
    updatePendingControl();
  }
  function record(stage, detail) {
    events.push({ at: new Date().toISOString(), stage, detail: String(detail || '').slice(0, 300) });
    if (events.length > 40) events.shift();
    try { sessionStorage.setItem(eventKey, JSON.stringify(events)); } catch (_) {}
  }
  function localTime(value) {
    const date = new Date(value);
    return isNaN(date.getTime()) ? String(value || '-') : date.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hourCycle: 'h23' });
  }
  function reportText() {
    const data = report();
    const labels = { 'page-opened':'เปิดหน้าสแกน', prepare:'เริ่มเตรียมระบบ', ready:'ระบบพร้อม', 'camera-start':'เริ่มเปิดกล้อง', 'face-matched':'ตรวจพบใบหน้าที่ตรงกัน', 'save-start':'เริ่มส่งรายการบันทึก', 'save-confirmed':'ได้รับคำยืนยันการบันทึก', help:'ข้อความแจ้งปัญหา', 'pending-cleared-by-user':'ผู้ใช้ล้างสถานะค้างในเครื่อง' };
    return [
      'รายงานเหตุขัดข้องระบบสแกนเข้า–ออกงาน',
      'ใช้ประกอบการตรวจสอบเท่านั้น ไม่ใช่หลักฐานลงเวลาสำเร็จ และยังไม่ได้ส่งถึงผู้ดูแล',
      '', 'หน้าเว็บ: ' + data.website,
      'สร้างรายงานเมื่อ: ' + localTime(data.reportedAtDeviceTime) + ' (เวลาไทยจากนาฬิกาอุปกรณ์)',
      'เปิดหน้านี้เมื่อ: ' + localTime(data.openedAtDeviceTime),
      'สถานะเครือข่ายที่เบราว์เซอร์รายงาน: ' + (data.online ? 'ออนไลน์' : 'ออฟไลน์'),
      'รุ่นระบบรายงาน: ' + data.version,
      'เบราว์เซอร์: ' + data.browser, '',
      data.pendingRequest ? 'มีรายการที่ยังไม่ทราบผล: ' + data.pendingRequest.id + '\nเริ่มส่งเมื่อ: ' + localTime(data.pendingRequest.createdAt) + '\nกรุณาตรวจตารางลงเวลาก่อนเริ่มรายการใหม่' : 'ไม่มีรายการส่งบันทึกที่ค้างอยู่ในเครื่องนี้',
      '', 'เหตุการณ์ที่ระบบบันทึกไว้ในแท็บนี้:',
      ...data.events.map(event => '- ' + localTime(event.at) + ' | ' + (labels[event.stage] || event.stage) + (event.detail ? ' | ' + event.detail : '')),
      '', 'หากยังลงเวลาไม่ได้ ให้ส่งรายงานนี้พร้อมชื่อและสาขาให้หัวหน้างานตรวจสอบทันที',
      'เวลาที่แสดงมาจากอุปกรณ์ ต้องให้ผู้ดูแลตรวจสอบเทียบกับข้อมูลจริง'
    ].join('\r\n');
  }
  function updatePendingControl() {
    const panel = document.getElementById('attendanceHelp');
    const control = panel && panel.querySelector('[data-pending-control]');
    if (control) control.hidden = !read();
  }
  function showReport(panel) {
    const box = panel.querySelector('[data-report]');
    box.value = reportText(); box.hidden = false;
    panel.querySelector('[data-copy]').hidden = false;
    return box;
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
      '<p>หากยังไม่ได้ ให้ดูรายงานหรือดาวน์โหลดแล้วส่งให้หัวหน้างานทันที ระบบไม่ได้ส่งรายงานให้อัตโนมัติ และรายงานนี้ไม่ใช่การลงเวลาสำเร็จ</p>' +
      '<button type="button" data-preview>ดูรายงานบนหน้านี้</button> ' +
      '<button type="button" data-download>ดาวน์โหลดรายงาน (.txt)</button> ' +
      '<a href="index.html">ตรวจตารางลงเวลา</a>' +
      '<textarea data-report hidden readonly aria-label="รายงานเหตุขัดข้อง" rows="12" style="box-sizing:border-box;width:100%;margin-top:12px;padding:8px;font:inherit;line-height:1.5;color:inherit;background:transparent;border:1px solid currentColor;border-radius:8px"></textarea>' +
      '<button type="button" data-copy hidden>คัดลอกข้อความรายงาน</button><p data-report-status role="status" aria-live="polite"></p>' +
      '<div data-pending-control hidden><p>มีรายการที่ยังไม่ทราบผล ต้องตรวจตารางหรือให้ผู้ดูแลตรวจสอบก่อนล้างสถานะ ปุ่มนี้ล้างเฉพาะสถานะค้างในเครื่อง ไม่ลบหรือแก้ข้อมูลใน Google Sheet และไม่ได้ลงเวลาให้</p>' +
      '<button type="button" data-clear>ตรวจตารางแล้ว — ล้างสถานะค้างในเครื่อง</button></div>';
    (document.querySelector('.page-wrap') || document.querySelector('main') || document.body).appendChild(panel);
    panel.querySelector('[data-preview]').onclick = () => showReport(panel);
    panel.querySelector('[data-download]').onclick = () => {
      const box = showReport(panel);
      const status = panel.querySelector('[data-report-status]');
      let url, anchor;
      try {
        url = URL.createObjectURL(new Blob(['\uFEFF', box.value], { type: 'text/plain;charset=utf-8' }));
        anchor = document.createElement('a'); anchor.href = url; anchor.download = 'attendance-issue-' + Date.now() + '.txt';
        document.body.appendChild(anchor); anchor.click();
        status.textContent = 'ส่งคำขอดาวน์โหลดแล้ว หากไม่พบไฟล์ ให้คัดลอกข้อความที่แสดงด้านบนส่งให้หัวหน้างาน';
      } catch (_) {
        status.textContent = 'เบราว์เซอร์นี้ดาวน์โหลดไม่ได้ ให้คัดลอกข้อความที่แสดงด้านบนส่งให้หัวหน้างาน';
      } finally {
        if (anchor) anchor.remove();
        if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    };
    panel.querySelector('[data-copy]').onclick = async () => {
      const box = panel.querySelector('[data-report]');
      const status = panel.querySelector('[data-report-status]');
      try {
        await navigator.clipboard.writeText(box.value);
        status.textContent = 'คัดลอกแล้ว กรุณาส่งข้อความนี้ให้หัวหน้างาน';
      } catch (_) {
        box.focus(); box.select();
        status.textContent = 'เลือกข้อความไว้แล้ว กรุณากดคัดลอกในเมนูของอุปกรณ์';
      }
    };
    panel.querySelector('[data-clear]').onclick = () => {
      if (!read()) return;
      if (confirm('คุณตรวจตารางหรือให้ผู้ดูแลตรวจสอบรายการเดิมแล้วใช่ไหม?\n\nปุ่มนี้ล้างเฉพาะสถานะค้างในเครื่อง ไม่ได้ลงเวลา ไม่ลบหรือแก้ข้อมูลใน Google Sheet\n\nถ้ารายการเดิมบันทึกสำเร็จแล้ว การสแกนใหม่อาจกลายเป็นเวลาออกงาน หากยังไม่ทราบผลให้กดยกเลิก')) {
        write(null); record('pending-cleared-by-user'); location.reload();
      }
    };
    updatePendingControl();
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
  record('page-opened');
  global.AttendanceRecovery = { VERSION, record, report, reportText, showHelp, begin, send, pending: read, complete: () => write(null) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})(window);
