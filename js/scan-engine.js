(function (global) {
  // Keep model input independent of the camera's negotiated resolution and CSS.
  function capture(video, canvas, maxSide = 480) {
    const width = video.videoWidth, height = video.videoHeight;
    if (!width || !height) return null;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const nextWidth = Math.round(width * scale), nextHeight = Math.round(height * scale);
    if (canvas.width !== nextWidth) canvas.width = nextWidth;
    if (canvas.height !== nextHeight) canvas.height = nextHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, nextWidth, nextHeight);
    return canvas;
  }
  async function warmup(api, canvas, options) {
    canvas.width = 150; canvas.height = 150;
    canvas.getContext('2d').fillRect(0, 0, 150, 150);
    // Compile all three networks before the first real face, not just detection.
    await api.detectSingleFace(canvas, options);
    await api.detectFaceLandmarks(canvas);
    await api.computeFaceDescriptor(canvas);
  }
  function savedMode(data) {
    const mode = data?.mode || data?.attendanceMode;
    if (mode === 'in' || mode === 'out') return mode;
    const message = String(data?.message || '');
    if (/เวลาเข้า/.test(message)) return 'in';
    if (/เวลาออก/.test(message)) return 'out';
    return null;
  }
  function resolveMode(rows, name) {
    if (!Array.isArray(rows)) return null;
    const clean = value => String(value || '').trim().normalize('NFC');
    const hasTime = value => !!clean(value) && clean(value) !== '-';
    // A name can have legacy duplicate rows. Never mistake a blank row for no check-in.
    const matches = rows.filter(row => clean(row['ชื่อ']) === clean(name));
    const entered = matches.some(row => hasTime(row['เวลาเข้า'] ?? row['เวลา']));
    if (!entered) return { key: 'in', label: 'เข้างาน' };
    const left = matches.some(row => hasTime(row['เวลาออก']));
    return { key: 'out', label: 'ออกงาน', ...(left ? { note: 'วันนี้ลงเวลาออกแล้ว การยืนยันจะอัปเดตเวลาออก' } : {}) };
  }
  global.FaceScanEngine = { capture, warmup, savedMode, resolveMode };
})(window);
