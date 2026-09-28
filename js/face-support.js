/* Shared camera/loading safeguards. Keep this file identical in each standalone site. */
(function () {
  'use strict';
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function timeout(promise, ms, message) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  async function fetchJSON(url, ms = 20000) {
    const controller = new AbortController();
    try {
      return await timeout((async () => {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok === false) throw new Error('เซิร์ฟเวอร์ตอบกลับ HTTP ' + response.status);
        const data = await response.json();
        if (data && data.error) throw new Error(data.message || data.error);
        return data;
      })(), ms, 'รอข้อมูลนานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
    } finally {
      controller.abort();
    }
  }

  const useTiny = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.deviceMemory && navigator.deviceMemory <= 6) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 6);
  const detectorOptions = () => useTiny ? new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.6}) : undefined;
  let libraryPromise;
  const modelLoads = new Map();
  function loadLibrary() {
    if (window.faceapi) return Promise.resolve();
    if (!libraryPromise) {
      const script = document.createElement('script');
      script.src = 'js/face-api.min.js';
      script.async = true;
      libraryPromise = new Promise((resolve, reject) => {
        script.onload = () => window.faceapi ? resolve() : reject(new Error('โหลดระบบ AI ไม่สำเร็จ'));
        script.onerror = () => reject(new Error('โหลดระบบ AI ไม่ได้ กรุณาตรวจอินเทอร์เน็ต'));
        document.head.appendChild(script);
      }).catch(error => {
        script.remove();
        libraryPromise = null;
        throw error;
      });
    }
    // Retain a pending script after a UI timeout so retry cannot inject two copies.
    return timeout(libraryPromise, 20000, 'โหลดระบบ AI นานเกินไป กรุณาลองใหม่ หรือรีเฟรชหน้า');
  }

  async function loadModels() {
    await loadLibrary();
    try { if (sessionStorage.getItem('attendance.aiBackend') === 'cpu' && faceapi.tf) faceapi.tf.setBackend('cpu'); } catch (_) {}
    // Reuse in-flight model loads: loadFromUri cannot be aborted safely.
    const url = 'models';
    const loads = [useTiny ? faceapi.nets.tinyFaceDetector : faceapi.nets.ssdMobilenetv1, faceapi.nets.faceLandmark68Net, faceapi.nets.faceRecognitionNet].map(net => {
      if (!modelLoads.has(net)) {
        const load = Promise.resolve().then(() => net.loadFromUri(url)).catch(error => {
          modelLoads.delete(net);
          throw error;
        });
        modelLoads.set(net, load);
      }
      return modelLoads.get(net);
    });
    await timeout(Promise.all(loads), 45000, 'โหลดโมเดล AI นานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่ หรือรีเฟรชหน้า');
  }

  let inference = null;
  let inferenceExpired = false;
  const input = document.createElement("canvas");
  async function detect(video, isCurrent) {
    // Keep ownership of the real operation even after a caller times out.
    if (inferenceExpired) throw new Error("ตัวตรวจจับค้าง กรุณารีเฟรชหน้าเพื่อเริ่มใหม่");
    if (inference) await timeout(inference.catch(() => {}), 12000, 'ระบบตรวจใบหน้าค้าง กรุณารีเฟรชหน้า');
    if (!isCurrent()) return null;
    const scale = Math.min(1, 640 / Math.max(video.videoWidth || 640, video.videoHeight || 480));
    const width = Math.round((video.videoWidth || 640) * scale), height = Math.round((video.videoHeight || 480) * scale);
    if (input.width !== width) input.width = width;
    if (input.height !== height) input.height = height;
    input.getContext('2d').drawImage(video, 0, 0, width, height);
    const task = Promise.resolve().then(() => faceapi.detectSingleFace(input, detectorOptions()).withFaceLandmarks().withFaceDescriptor());
    inference = task;
    task.then(() => { if (inference === task) inference = null; }, () => { if (inference === task) inference = null; });
    try { return await timeout(task, 12000, 'ระบบตรวจใบหน้าค้าง กรุณารีเฟรชหน้า'); } catch (error) { inferenceExpired = true; try { sessionStorage.setItem('attendance.aiBackend', 'cpu'); } catch (_) {} throw error; }
  }

  function cameraMessage(error) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return 'ยังเปิดกล้องไม่ได้ กรุณาอนุญาตกล้องในการตั้งค่าเว็บไซต์ แล้วกดเปิดกล้องใหม่ หากเปิดผ่าน LINE ให้ลองเปิดลิงก์ใน Safari หรือ Chrome';
      case 'NotFoundError': return 'ไม่พบกล้องบนอุปกรณ์นี้ กรุณาตรวจการเชื่อมต่อกล้อง';
      case 'NotReadableError':
      case 'TrackStartError': return 'กล้องอาจถูกแอปอื่นใช้งานอยู่ กรุณาปิดแอปที่ใช้กล้องแล้วลองใหม่';
      case 'OverconstrainedError': return 'กล้องไม่รองรับการตั้งค่านี้ กรุณาลองเปิดด้วย Safari หรือ Chrome';
      case 'SecurityError': return 'เบราว์เซอร์บล็อกกล้อง กรุณาตรวจสิทธิ์เว็บไซต์ หรือเปิดลิงก์ใน Safari หรือ Chrome';
      default: return error.message || 'เปิดกล้องไม่สำเร็จ กรุณาลองใหม่';
    }
  }

  function createCamera(video, onError) {
    let generation = 0;
    let stream = null;
    let starting = false;
    let waitingForTap = false;
    let ready = false;
    let monitor = null;
    let frameCallback = null;
    let lastFrameAt = 0;
    let lastMonitorAt = 0;
    let lastVideoTime = 0;
    const cleanups = [];

    function stop() {
      generation++;
      ready = false;
      starting = false;
      waitingForTap = false;
      clearInterval(monitor);
      monitor = null;
      if (frameCallback !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
      frameCallback = null;
      cleanups.splice(0).forEach(remove => remove());
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.pause();
      video.srcObject = null;
      video.classList.remove('active');
    }

    function fail(error) {
      stop();
      onError(cameraMessage(error));
    }

    function listen(target, event, listener) {
      target.addEventListener(event, listener);
      cleanups.push(() => target.removeEventListener(event, listener));
    }

    async function start() {
      if (starting) return false;
      const manualPlayback = waitingForTap;
      if (!manualPlayback) stop();
      const run = generation;
      starting = true;
      let playing = false;
      try {
        if (!window.isSecureContext) throw new Error('กล้องต้องเปิดผ่านลิงก์ HTTPS กรุณาใช้ลิงก์ที่ขึ้นต้นด้วย https://');
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้ กรุณาเปิดลิงก์ใน Safari หรือ Chrome');
        }
        if (document.hidden) throw new Error('กรุณากลับมาที่หน้านี้แล้วกดเปิดกล้องใหม่');
        if (!stream) {
          const request = navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } }
          });
          request.then(lateStream => {
            if (run !== generation) lateStream.getTracks().forEach(track => track.stop());
          }, () => {});
          const acquired = await timeout(request, 12000, 'รอสิทธิ์กล้องนานเกินไป กรุณาอนุญาตกล้องแล้วกดเปิดกล้องใหม่');
          if (run !== generation) { acquired.getTracks().forEach(track => track.stop()); return false; }
          stream = acquired;
        }
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        if (video.srcObject !== stream) video.srcObject = stream;
        playing = true;
        await timeout((async () => {
          // On a second tap this executes synchronously in the click gesture,
          // using the acquired stream instead of awaiting getUserMedia again.
          // Safari can display real frames while play() remains pending. Do not wait on it.
          let playbackError = null;
          Promise.resolve(video.play()).catch(error => { playbackError = error; });
          while (run === generation && (video.paused || video.readyState < 2 || !video.videoWidth || !video.videoHeight)) {
            if (playbackError) throw playbackError;
            await delay(100);
          }
        })(), 12000, 'ยังไม่มีภาพจากกล้อง กรุณากดเปิดกล้องใหม่');
        playing = false;
        if (run !== generation) return false;
        const tracks = stream.getVideoTracks();
        if (!tracks.length || tracks.some(track => track.readyState !== 'live' || track.muted)) {
          throw new Error('กล้องยังไม่ส่งภาพ กรุณากดเปิดกล้องใหม่');
        }
        ready = true;
        waitingForTap = false;
        starting = false;
        video.classList.add('active');
        lastFrameAt = performance.now();
        lastMonitorAt = lastFrameAt;
        lastVideoTime = video.currentTime;
        if (video.requestVideoFrameCallback) {
          const frame = () => {
            if (run !== generation) return;
            lastFrameAt = performance.now();
            frameCallback = video.requestVideoFrameCallback(frame);
          };
          frameCallback = video.requestVideoFrameCallback(frame);
        }
        const interrupted = () => {
          if (run === generation) fail(new Error('ภาพกล้องหยุด กรุณากดเปิดกล้องใหม่'));
        };
        tracks.forEach(track => { listen(track, 'ended', interrupted); listen(track, 'mute', interrupted); });
        listen(video, 'pause', () => { if (video.paused) interrupted(); });
        listen(video, 'error', interrupted);
        monitor = setInterval(() => {
          if (run !== generation) return;
          const now = performance.now();
          const delayed = now - lastMonitorAt > 3000;
          lastMonitorAt = now;
          if (video.paused || video.ended || tracks.some(track => track.readyState !== 'live')) {
            interrupted();
            return;
          }
          // Slow synchronous inference can delay timers and frame callbacks together.
          // Allow rendering to resume before deciding that a live camera has stalled.
          if (delayed) { lastFrameAt = now; return; }
          if (!video.requestVideoFrameCallback && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            lastFrameAt = now;
          }
          if (now - lastFrameAt > 8000) interrupted();
        }, 1000);
        return true;
      } catch (error) {
        if (run === generation) {
          if (playing && error.name === 'NotAllowedError' && !manualPlayback) {
            starting = false;
            waitingForTap = true;
            const tapTimer = setTimeout(() => {
              if (run === generation && waitingForTap) fail(new Error('ยังไม่ได้เริ่มแสดงภาพ กรุณากดเปิดกล้องใหม่'));
            }, 20000);
            cleanups.push(() => clearTimeout(tapTimer));
            onError('เบราว์เซอร์ต้องการให้แตะอีกครั้ง กรุณากดเปิดกล้องใหม่เพื่อแสดงภาพ', true);
          } else {
            fail(error);
          }
        }
        return false;
      }
    }

    function suspend() {
      if (stream || starting) fail(new Error('กล้องหยุดเมื่อออกจากหน้า กรุณากดเปิดกล้องใหม่เพื่อใช้งานต่อ'));
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
    window.addEventListener('pagehide', suspend);
    return { start, stop, isReady: () => ready && !video.paused && video.readyState >= 2 && video.videoWidth > 0 };
  }

  window.FaceSupport = { fetchJSON, loadModels, detect, createCamera, requiresReload: () => inferenceExpired };
})();
