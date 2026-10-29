// Camera startup must not depend on play() settling: Safari can deliver frames
// while that promise is still pending. A session owns and releases its stream.
(function (global) {
  const stopTracks = stream => { if (stream) stream.getTracks().forEach(track => track.stop()); };
  const cameraError = (name, message) => Object.assign(new Error(message), { name });

  function open({ video, mediaDevices, constraints, timeoutMs = 12000, onStage = () => {} }) {
    const controller = new AbortController();
    const signal = controller.signal;
    let stream = null;
    let stopped = false;
    let expired = false;
    const abortedError = () => cameraError(expired ? 'TimeoutError' : 'AbortError',
      expired ? 'กล้องไม่พร้อมภายในเวลาที่กำหนด กรุณาแตะเปิดกล้องอีกครั้ง' : 'ยกเลิกการเปิดกล้อง');
    const report = stage => { try { onStage(stage); } catch (_) {} };
    const deadline = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(deadline);
      controller.abort();
      stopTracks(stream);
      if (stream && video.srcObject === stream) {
        video.pause();
        video.srcObject = null;
      }
    }

    function request(requestConstraints) {
      if (signal.aborted) return Promise.reject(abortedError());
      return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => { settled = true; reject(abortedError()); };
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
          if (signal.aborted) throw abortedError();
          return mediaDevices.getUserMedia(requestConstraints);
        }).then(value => {
          signal.removeEventListener('abort', abort);
          // The permission prompt may resolve after timeout/navigation/retry.
          if (settled || signal.aborted) { stopTracks(value); return; }
          settled = true;
          resolve(value);
        }, error => {
          signal.removeEventListener('abort', abort);
          if (!settled) { settled = true; reject(error); }
        });
      });
    }

    function waitForFrames() {
      return new Promise((resolve, reject) => {
        const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'timeupdate', 'resize'];
        let finished = false;
        let poll;
        const done = error => {
          if (finished) return;
          finished = true;
          clearInterval(poll);
          events.forEach(event => video.removeEventListener(event, check));
          signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve();
        };
        const hasFrames = () => !video.paused && !video.ended && video.readyState >= 2
          && video.videoWidth > 0 && video.videoHeight > 0;
        const check = () => { if (hasFrames()) done(); };
        const abort = () => done(abortedError());
        if (signal.aborted) { abort(); return; }
        events.forEach(event => video.addEventListener(event, check));
        signal.addEventListener('abort', abort, { once: true });
        poll = setInterval(check, 100); // Events can be missed on iOS; poll as well.
        try {
          Promise.resolve(video.play()).then(check, error => hasFrames() ? done() : done(error));
        } catch (error) { done(error); }
        check();
      });
    }

    const ready = (async () => {
      try {
        report('requesting-camera');
        try {
          stream = await request(constraints);
        } catch (error) {
          if (signal.aborted || error.name !== 'OverconstrainedError') throw error;
          report('camera-constraints-fallback');
          stream = await request({ video: { facingMode: 'user' }, audio: false });
        }
        if (signal.aborted) { stopTracks(stream); throw abortedError(); }
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.srcObject = stream;
        report('waiting-for-frames');
        await waitForFrames();
        if (signal.aborted) throw abortedError();
        clearTimeout(deadline);
        report('camera-ready');
        return stream;
      } catch (error) {
        stop();
        report(expired ? 'camera-timeout' : 'camera-stopped');
        throw error;
      }
    })();
    return { ready, stop };
  }
  global.FaceScanCamera = { open };
})(window);
