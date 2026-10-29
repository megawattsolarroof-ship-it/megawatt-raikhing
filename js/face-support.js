/* All in One scanner adapter. Identical across branches; no branch data or routing here. */
(function () {
  'use strict';
  function timeout(promise, ms, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(message), {name:'TimeoutError'})), ms);
    })]).finally(() => clearTimeout(timer));
  }
  async function fetchJSON(url, ms = 20000) {
    const controller = new AbortController();
    try {
      return await timeout((async () => {
        const response = await fetch(url, {signal:controller.signal});
        if (!response.ok) throw new Error('เซิร์ฟเวอร์ตอบกลับ HTTP ' + response.status);
        const data = await response.json();
        if (data && data.error) throw new Error(data.message || data.error);
        return data;
      })(), ms, 'รอข้อมูลนานเกินไป กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
    } finally { controller.abort(); }
  }

  // Same device selection, detector options and frame policy as the live All in One.
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const lowPower = !!((navigator.deviceMemory && navigator.deviceMemory <= 6) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 6) || (mobile && !navigator.deviceMemory));
  const requested = new URLSearchParams(location.search).get('detector');
  const registration = /(?:^|\/)register(?:\.html)?\/?$/.test(location.pathname);
  const useTiny = !registration && (requested === 'tiny' || (requested !== 'ssd' && lowPower));
  const policy = Object.freeze({lowPower, detector:useTiny?'tiny':'ssd',
    minScore:useTiny?0.5:0.6, confirmFrames:lowPower?2:3, scanGapMs:lowPower?220:120});
  const detectorOptions = () => useTiny
    ? new faceapi.TinyFaceDetectorOptions({inputSize:lowPower?320:416,scoreThreshold:0.45})
    : new faceapi.SsdMobilenetv1Options({minConfidence:0.5});
  let libraryPromise, modelsPromise, inference = null, reloadRequired = false;
  const modelLoads = new Map();
  const input = document.createElement('canvas');

  function loadLibrary() {
    if (window.faceapi) return Promise.resolve();
    if (!libraryPromise) {
      const script = document.createElement('script');
      script.src = 'js/face-api.min.js'; script.async = true;
      libraryPromise = new Promise((resolve, reject) => {
        script.onload = () => window.faceapi ? resolve() : reject(new Error('โหลดระบบ AI ไม่สำเร็จ'));
        script.onerror = () => reject(new Error('โหลดระบบ AI ไม่ได้ กรุณาตรวจอินเทอร์เน็ต'));
        document.head.appendChild(script);
      }).catch(error => {script.remove();libraryPromise=null;throw error;});
    }
    return timeout(libraryPromise,20000,'โหลดระบบ AI นานเกินไป กรุณาลองใหม่');
  }
  function useCPUAfterFailure() {
    reloadRequired = true;
    try {sessionStorage.setItem('attendance.aiBackend','cpu');} catch (_) {}
  }
  async function loadModels() {
    await loadLibrary();
    if (!modelsPromise) {
      modelsPromise = (async () => {
        try {if (sessionStorage.getItem('attendance.aiBackend') === 'cpu' && faceapi.tf) await faceapi.tf.setBackend('cpu');} catch (_) {}
        const nets = [useTiny?faceapi.nets.tinyFaceDetector:faceapi.nets.ssdMobilenetv1,
          faceapi.nets.faceLandmark68Net,faceapi.nets.faceRecognitionNet];
        await Promise.all(nets.map(net => {
          if (!modelLoads.has(net)) modelLoads.set(net,Promise.resolve().then(() => net.loadFromUri('models')).catch(error => {modelLoads.delete(net);throw error;}));
          return modelLoads.get(net);
        }));
        // Compile all three networks before showing the start button, as in All in One.
        try {await FaceScanEngine.warmup(faceapi,document.createElement('canvas'),detectorOptions());}
        catch(error) {useCPUAfterFailure();throw error;}
      })().catch(error => {modelsPromise=null;throw error;});
    }
    try {await timeout(modelsPromise,45000,'เตรียมระบบสแกนนานเกินไป กรุณาโหลดหน้าใหม่');}
    catch(error) {if(error.name==='TimeoutError')useCPUAfterFailure();throw error;}
  }
  async function detect(video, isCurrent) {
    if (reloadRequired) throw new Error('กรุณาโหลดหน้าใหม่เพื่อเริ่มระบบสแกน');
    if (inference) await timeout(inference.catch(() => {}),12000,'ระบบตรวจใบหน้าค้าง กรุณาโหลดหน้าใหม่');
    if (!isCurrent()) return null;
    const canvas = FaceScanEngine.capture(video,input);
    if (!canvas) return null;
    const task = Promise.resolve().then(() => faceapi.detectSingleFace(canvas,detectorOptions()).withFaceLandmarks().withFaceDescriptor());
    inference=task;
    task.then(() => {if(inference===task)inference=null;},() => {if(inference===task)inference=null;});
    try {return await timeout(task,12000,'ระบบตรวจใบหน้าค้าง กรุณาโหลดหน้าใหม่');}
    catch(error) {if(error.name==='TimeoutError')useCPUAfterFailure();throw error;}
  }
  function toKnownFaces(rows) {
    if (!Array.isArray(rows)) throw new Error('ข้อมูลพนักงานไม่ถูกต้อง กรุณาลองใหม่');
    const valid = rows.filter(row => row && typeof row.label==='string' && row.label.trim() &&
      Array.isArray(row.descriptor) && row.descriptor.length===128 &&
      row.descriptor.every(value => typeof value==='number' && Number.isFinite(value)));
    if(rows.length && !valid.length) throw new Error('ข้อมูลใบหน้าไม่สมบูรณ์ กรุณาให้ผู้ดูแลตรวจข้อมูลหรือลงทะเบียนใหม่');
    if(valid.length!==rows.length) console.warn('ข้ามข้อมูลใบหน้าที่ไม่สมบูรณ์ '+(rows.length-valid.length)+' แถว');
    return valid.map(row => ({name:row.label,descriptor:new Float32Array(row.descriptor)}));
  }
  function cameraMessage(error) {
    const messages = {
      NotAllowedError:'กรุณาอนุญาตกล้องแล้วแตะเปิดกล้องใหม่ หากเปิดผ่าน LINE ให้เปิดลิงก์ใน Safari หรือ Chrome',
      NotFoundError:'ไม่พบกล้อง กรุณาตรวจการเชื่อมต่อกล้อง',
      NotReadableError:'กล้องถูกแอปอื่นใช้งานอยู่ กรุณาปิดแอปกล้องแล้วลองใหม่',
      TimeoutError:'กล้องยังไม่ส่งภาพ กรุณาอนุญาตกล้องแล้วแตะเปิดกล้องใหม่',
      OverconstrainedError:'กล้องไม่รองรับการตั้งค่า กรุณาเปิดด้วย Safari หรือ Chrome'
    };
    return messages[error.name] || error.message || 'เปิดกล้องไม่สำเร็จ กรุณาลองใหม่';
  }
  function createCamera(video,onError) {
    let session=null, ready=false, starting=false, monitor=null, frameCallback=null;
    let lastFrameAt=0,lastMonitorAt=0,lastVideoTime=0,unavailableAt=0;
    const cleanups=[];
    function stop() {
      const previous=session;session=null;ready=false;starting=false;
      clearInterval(monitor);monitor=null;
      if(frameCallback!==null && video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frameCallback);
      frameCallback=null;cleanups.splice(0).forEach(remove=>remove());
      if(previous)previous.stop();
      video.classList.remove('active');
    }
    function fail(message) {stop();onError(message);}
    function listen(target,event,fn) {target.addEventListener(event,fn);cleanups.push(()=>target.removeEventListener(event,fn));}
    async function start() {
      if(starting)return false;
      stop();starting=true;
      let current;
      try {
        if(!window.isSecureContext)throw new Error('กรุณาเปิดลิงก์ HTTPS เพื่อใช้กล้อง');
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้ กรุณาเปิดลิงก์ใน Safari หรือ Chrome');
        if(document.hidden)throw new Error('กรุณากลับมาที่หน้านี้แล้วแตะเปิดกล้อง');
        // This is the exact camera session module from the live All in One.
        current=FaceScanCamera.open({video,mediaDevices:navigator.mediaDevices,timeoutMs:12000,
          constraints:{audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:24}}}});
        session=current;
        const stream=await current.ready;
        if(session!==current)return false;
        const tracks=stream.getVideoTracks();
        if(!tracks.length || tracks.some(track=>track.readyState!=='live'))throw new Error('กล้องยังไม่ส่งภาพ กรุณาลองใหม่');
        ready=true;starting=false;video.classList.add('active');
        lastFrameAt=lastMonitorAt=performance.now();lastVideoTime=video.currentTime;unavailableAt=0;
        if(video.requestVideoFrameCallback) {
          const frame=()=>{if(session!==current)return;lastFrameAt=performance.now();frameCallback=video.requestVideoFrameCallback(frame);};
          frameCallback=video.requestVideoFrameCallback(frame);
        }
        const ended=()=>{if(session===current)fail('ภาพกล้องหยุด กรุณาแตะเปิดกล้องใหม่');};
        tracks.forEach(track=>listen(track,'ended',ended));listen(video,'error',ended);
        // Let brief interruptions recover, like All in One, instead of failing on one mute event.
        monitor=setInterval(()=>{
          if(session!==current)return;
          const now=performance.now(),delayed=now-lastMonitorAt>3000;lastMonitorAt=now;
          if(tracks.some(track=>track.readyState!=='live')){ended();return;}
          if(delayed){lastFrameAt=now;unavailableAt=0;return;}
          if(!video.requestVideoFrameCallback && video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;lastFrameAt=now;}
          if(video.paused || video.ended || video.readyState<2 || tracks.some(track=>track.muted)) {
            if(!unavailableAt)unavailableAt=now;
            if(video.paused && video.srcObject)Promise.resolve(video.play()).catch(()=>{});
          } else unavailableAt=0;
          if((unavailableAt && now-unavailableAt>8000)||now-lastFrameAt>8000)ended();
        },500);
        return true;
      } catch(error) {
        if(!current || session===current)fail(cameraMessage(error));
        return false;
      }
    }
    function suspend(){if(session || starting)fail('กล้องหยุดเมื่อออกจากหน้า กรุณาแตะเปิดกล้องใหม่');}
    document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
    window.addEventListener('pagehide',suspend);
    return {start,stop,isReady:()=>ready&&!video.paused&&!video.ended&&video.readyState>=2&&video.videoWidth>0,
      isActive:()=>!!session&&ready};
  }
  window.FaceSupport={fetchJSON,loadModels,detect,createCamera,toKnownFaces,policy,
    requiresReload:()=>reloadRequired,useCPUAfterFailure};
})();
