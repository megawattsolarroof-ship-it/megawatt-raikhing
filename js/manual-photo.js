/* Live capture only. No face detection or matching; evidence is not identity verification. */
(function(global) {
  'use strict';
  function mount(options) {
    const $ = id => document.getElementById(id);
    const video=$('manualPhotoVideo'), preview=$('manualPhotoPreview'), start=$('manualPhotoStart');
    const capture=$('manualPhotoCapture'), skip=$('manualPhotoSkip'), status=$('manualPhotoStatus');
    const reason=$('manualPhotoReason'), reasonWrap=$('manualPhotoReasonWrap');
    let session=null, epoch=0, opening=false, ready=false, shot=null, receipt=null, failure='', without=false, locked=false;
    function say(message) {status.textContent=message;}
    function stop() {epoch++; session?.stop();session=null;opening=false;ready=false;video.hidden=true;capture.hidden=true;}
    function sync(notify=true) {
      start.disabled=locked || opening || !options.name();capture.disabled=locked || !ready;
      skip.disabled=locked;reason.disabled=locked;
      skip.hidden=!failure || without;
      reasonWrap.hidden=!without;reason.required=without;
      start.textContent=opening?'กำลังเปิดกล้อง...':shot?'ถ่ายรูปใหม่':'เปิดกล้องถ่ายรูป';
      if(notify) options.changed();
    }
    function reset() {
      stop();shot=null;receipt=null;failure='';without=false;reason.value='';preview.hidden=true;preview.removeAttribute('src');
      say('พิมพ์ชื่อ–นามสกุลให้ตรงกับรายชื่อพนักงาน แล้วเปิดกล้อง');sync();
    }
    start.addEventListener('click',async()=>{
      if(locked || opening || !options.name())return;
      stop();const run=epoch;shot=null;receipt=null;without=false;failure='';preview.hidden=true;preview.removeAttribute('src');
      opening=true;video.hidden=false;say('กรุณาอนุญาตกล้องเพื่อถ่ายภาพหลักฐาน');sync();
      try {
        if(!navigator.mediaDevices?.getUserMedia)throw new Error('อุปกรณ์นี้เปิดกล้องบนหน้านี้ไม่ได้');
        session=FaceScanCamera.open({video,mediaDevices:navigator.mediaDevices,constraints:{video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false}});
        await session.ready;
        if(run!==epoch)return;
        ready=true;capture.hidden=false;say('ให้เห็นใบหน้าชัด แล้วกด “ถ่ายรูปนี้”');
      } catch(error) {
        if(run!==epoch)return;
        stop();failure='camera';say('เปิดกล้องไม่ได้ ลองเปิดกล้องอีกครั้ง หรือเลือกลงเวลาโดยไม่มีภาพพร้อมระบุเหตุผล');
      } finally {if(run===epoch)opening=false;sync();}
    });
    capture.addEventListener('click',()=>{
      if(locked || !ready || !video.videoWidth || video.readyState<2)return;
      try {
        const canvas=document.createElement('canvas'),scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
        canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        const jpeg=canvas.toDataURL('image/jpeg',0.78);
        if(!jpeg.startsWith('data:image/jpeg;base64,') || jpeg.length>350000)throw new Error('ภาพมีขนาดใหญ่เกินไป');
        shot={jpeg,id:crypto.randomUUID(),name:options.name()};receipt=null;failure='';without=false;
        preview.src=jpeg;preview.hidden=false;stop();say('ถ่ายภาพแล้ว ภาพจะส่งพร้อมการยืนยันลงเวลา');sync();
      } catch(error) {stop();failure='capture';say('ถ่ายภาพไม่สำเร็จ กรุณาลองใหม่ หรือระบุเหตุผลเพื่อลงเวลาโดยไม่มีภาพ');sync();}
    });
    skip.addEventListener('click',()=>{
      if(locked || !failure)return;
      stop();without=true;preview.hidden=true;preview.removeAttribute('src');
      say(failure==='upload'?'ภาพยังไม่ได้รับคำยืนยันการจัดเก็บ รายการลงเวลาจะระบุว่าภาพไม่ยืนยัน':'รายการลงเวลาจะระบุว่าไม่มีภาพหลักฐาน');sync();reason.focus();
    });
    reason.addEventListener('input',sync);
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden && session) {stop();failure='camera';say('กล้องหยุดเมื่อออกจากหน้านี้ กรุณาเปิดกล้องอีกครั้ง');sync();}
    });
    global.addEventListener('pagehide',stop);
    return {
      reset,stop,
      refresh:()=>sync(false),
      lock:value=>{locked=value;sync(false);},
      valid:()=>!!receipt || (!!shot && !without) || (without && !!reason.value.trim()),
      async upload(name) {
        if(without) return '[ไม่มีภาพยืนยัน: '+(failure==='upload'?'อัปโหลดภาพไม่ยืนยัน; ':'')+reason.value.trim()+']';
        if(!shot || shot.name!==name)throw new Error('กรุณาถ่ายรูปใหม่สำหรับชื่อพนักงานนี้');
        if(receipt)return '[ภาพหลักฐาน: '+receipt+']';
        say('กำลังเก็บภาพหลักฐาน...');
        try {
          const result=await options.upload({id:shot.id,name,jpeg:shot.jpeg});
          if(!result || result.status!=='stored' || typeof result.reference!=='string' || !/^evidence\/[a-z0-9_-]+\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]{36}\.jpg$/.test(result.reference))throw new Error('ยังไม่ได้รับคำยืนยันการเก็บภาพ');
          receipt=result.reference;say('เก็บภาพหลักฐานแล้ว');return '[ภาพหลักฐาน: '+receipt+']';
        } catch(error) {failure='upload';say('ยังเก็บภาพไม่สำเร็จ กดยืนยันเพื่อลองส่งภาพเดิมอีกครั้ง หรือเลือกลงเวลาโดยไม่มีภาพ');sync();throw new Error('ยังเก็บภาพไม่สำเร็จ และยังไม่ได้ส่งเวลา กรุณาลองใหม่หรือเลือกลงเวลาโดยไม่มีภาพ');}
      }
    };
  }
  global.ManualPhoto={mount};
})(window);
