/* Manual fallback: explicitly requested by the owner; writes through the existing branch API. */
(function (global) {
  'use strict';
  const MARKER = '[ลงเวลาโดยไม่สแกนหน้า]';
  function mount(options) {
    const button = document.getElementById('btnManualAttendance');
    const panel = document.getElementById('manualAttendancePanel');
    const form = document.getElementById('manualAttendanceForm');
    const select = document.getElementById('manualEmployee');
    const note = document.getElementById('manualNote');
    const status = document.getElementById('manualStatus');
    const submit = document.getElementById('manualSubmit');
    const close = document.getElementById('manualClose');
    const retry = document.getElementById('manualReloadNames');
    const mode = document.getElementById('manualModeHint');
    let opened = false, saving = false, saved = false, loading = false, names = [], generation = 0, today = null;
    let protocol = false;
    const pending = () => AttendanceRecovery.pending();
    const ours = entry => entry && entry.endpoint === options.endpoint && entry.target === options.target &&
      typeof entry.payload?.note === 'string' && entry.payload.note.startsWith(MARKER);
    function say(text, error = false) {
      status.textContent = text; status.classList.toggle('manual-error', error);
    }
    function label() {
      if (pending()) return 'ส่งรายการเดิมอีกครั้ง';
      if (options.siteCheckin) return 'ยืนยันเช็กอินหน้างาน';
      if (!Array.isArray(today) || !select.value) return 'ยืนยันลงเวลาเข้า–ออกงาน';
      const row = today.find(r => String(r['ชื่อ'] || '').trim() === select.value &&
        String(r['เวลาเข้า'] ?? r['เวลา'] ?? '').trim() && String(r['เวลาเข้า'] ?? r['เวลา']) !== '-');
      return row ? 'ยืนยันออกงานแล้ว' : 'ยืนยันเข้างานแล้ว';
    }
    function sync() {
      const entry = pending();
      const blocked = entry && (!ours(entry) || !protocol || Date.now() - Date.parse(entry.createdAt) > 3600000);
      select.disabled = saving || !!entry || loading || saved;
      note.disabled = saving || !!entry || saved;
      close.disabled = saving; retry.disabled = saving || loading;
      submit.disabled = saving || saved || loading || !names.includes(select.value) || !!blocked;
      submit.textContent = saving ? 'กำลังบันทึก...' : label();
      if (blocked) say('มีรายการเดิมที่ยังไม่ทราบผล กรุณาตรวจตารางลงเวลาก่อนเริ่มรายการใหม่', true);
    }
    async function loadNames() {
      if (loading || saving || saved) return;
      const run = ++generation; loading = true; sync();
      say('กำลังโหลดรายชื่อพนักงาน...');
      try {
        const rows = await options.read('getKnownFaces');
        if (run !== generation || !opened) return;
        if (!Array.isArray(rows)) throw new Error('โหลดรายชื่อพนักงานไม่สำเร็จ กรุณาลองใหม่');
        // Manual attendance needs the name only, even when that employee's descriptor is malformed.
        names = [...new Set(rows.filter(r => r && typeof r.label === 'string').map(r => r.label.trim()).filter(Boolean))]
          .sort((a,b) => a.localeCompare(b,'th'));
        select.replaceChildren(new Option('เลือกชื่อของคุณ', ''));
        names.forEach(name => select.add(new Option(name, name)));
        if (!names.length) throw new Error('ยังไม่มีรายชื่อพนักงานของสาขานี้ กรุณาติดต่อผู้ดูแล');
        const entry = pending();
        if (ours(entry)) {
          select.value = entry.name;
          note.value = entry.payload.note.slice(MARKER.length).replace(/^\s*\|\s*/, '');
          say('รายการก่อนหน้ายังไม่ทราบผล ตรวจตารางหรือส่งรายการเดิมอีกครั้งได้');
        } else say('เลือกชื่อของคุณ แล้วกดยืนยันเพื่อบันทึกเวลา');
      } catch (error) {
        if (run === generation && opened) {names = []; say(error.message || 'โหลดรายชื่อไม่สำเร็จ', true);}
      } finally {
        if (run === generation) {loading = false; sync();}
      }
    }
    async function open() {
      if (saving || saved || options.busy()) return;
      opened = !opened;
      button.setAttribute('aria-expanded', String(opened));
      panel.hidden = !opened;
      document.body.classList.toggle('manual-attendance-active', opened);
      if (!opened) {
        generation++; loading = false; options.close(); button.focus(); return;
      }
      options.open();
      AttendanceRecovery.record('manual-opened');
      mode.textContent = options.siteCheckin ? 'บันทึกเวลาเช็กอินหน้างานตามเวลาของระบบ' :
        'ครั้งแรกของวันเป็นเวลาเข้า ครั้งถัดไปเป็นเวลาออก ระบบจะแจ้งผลหลังบันทึก';
      protocol = false;
      // Configuration is separate from AI loading; a failed camera/model never blocks this form.
      options.read('getConfig').then(config => {protocol = config.attendanceProtocol === 1; sync();}).catch(() => {});
      if (!options.siteCheckin) options.read('getTodayAttendance').then(rows => {
        if (opened) {today = rows; sync();}
      }).catch(() => {});
      select.focus();
      await loadNames();
      if (opened && !select.disabled) select.focus();
    }
    button.addEventListener('click', open);
    close.addEventListener('click', () => {if (!saving) void open();});
    retry.addEventListener('click', loadNames);
    select.addEventListener('change', sync);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving || saved || options.busy() || !names.includes(select.value)) return;
      if (!form.reportValidity()) return;
      const entry = pending();
      if (entry && (!ours(entry) || !protocol || entry.name !== select.value)) {sync(); return;}
      const name = select.value;
      const message = MARKER + (note.value.trim() ? ' | ' + note.value.trim() : '');
      saving = true; options.lock(true); sync(); say('กำลังตรวจ GPS และบันทึกเวลา...');
      try {
        // Refresh the existing branch GPS rule immediately before every send/retry.
        const location = await options.prepareLocation();
        protocol = location.safeRetry;
        if (pending() && !protocol) throw new Error('กรุณาตรวจรายการค้างในตารางก่อนเริ่มรายการใหม่');
        const result = await options.send(name, message, location);
        saved = true; form.hidden = true;
        const action = result.mode === 'in' ? 'บันทึกเวลาเข้างานแล้ว' : result.mode === 'out' ? 'บันทึกเวลาออกงานแล้ว' :
          options.siteCheckin ? 'บันทึกเช็กอินหน้างานแล้ว' : 'บันทึกเวลาเรียบร้อยแล้ว';
        say('✓ ' + action + (result.time ? ' ' + result.time + ' น.' : '') + ' — ' + name);
        document.getElementById('manualSavedLink').hidden = false;
        button.disabled = true; button.textContent = 'บันทึกเวลาเรียบร้อยแล้ว';
        AttendanceRecovery.record('manual-save-confirmed');
        status.focus();
      } catch (error) {
        say(error.message || 'ยังบันทึกไม่สำเร็จ กรุณาลองใหม่', true);
      } finally {saving = false; options.lock(false); sync();}
    });
    sync();
    return {isOpen: () => opened};
  }
  global.ManualAttendance = {mount};
})(window);
