// SECTION: Camera Modal
// Purpose : Open/close camera modal, manage streams (peserta/admin), capture frames.
// Depends : core/base.js (State, UI, $), core/face.js, core/busy.js.
// Provides: initCameraModals(), openCamera(mode), closeCamera(), captureCanvas().

/* =========================
   Camera
   ========================= */
function stopStream(videoEl){
  try{
    const old = videoEl?.srcObject;
    if (old && old.getTracks) old.getTracks().forEach(t=>t.stop());
  }catch(e){}
}

// helper: ensure we have permission so device labels appear
async function ensureCamPermission(){
  // Jika belum pernah grant, enumerateDevices() biasanya label kosong.
  // Trick: minta stream singkat lalu stop.
  try{
    const tmp = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
    tmp.getTracks().forEach(t=>t.stop());
  } catch(e){
    // biarkan error dilempar ke caller
    throw e;
  }
}

function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// pilih device kamera (front/back) dari enumerateDevices
async function pickCameraDeviceId(prefer='environment'){
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');

  if (!cams.length) return null;

  // prefer by label keyword
  const wantBack = prefer === 'environment';
  const backKw = /(back|rear|environment|world)/i;
  const frontKw = /(front|user|face)/i;

  // iOS kadang label tidak jelas, tapi setelah izin biasanya muncul
  let chosen = null;

  if (wantBack){
    chosen = cams.find(c => backKw.test(c.label));
    if (!chosen) chosen = cams[cams.length - 1]; // fallback: biasanya yang terakhir back
  } else {
    chosen = cams.find(c => frontKw.test(c.label));
    if (!chosen) chosen = cams[0]; // fallback: biasanya yang pertama front
  }

  return chosen?.deviceId || null;
}

// inti: start camera dengan fallback
async function startCamera(videoEl, prefer='user'){
  stopStream(videoEl);

  // Pastikan getUserMedia tersedia
  if (!navigator.mediaDevices?.getUserMedia){
    throw new Error('Browser tidak mendukung getUserMedia. Gunakan Chrome/Safari terbaru.');
  }

  // 1) coba dengan facingMode dulu (paling simpel)
  try{
    const constraints = {
      video: {
        facingMode: { ideal: prefer }, // ideal supaya tidak langsung fail di device tertentu
        width: { ideal: 1280 },
        height:{ ideal: 720 }
      },
      audio:false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await new Promise(r => videoEl.onloadedmetadata = r);
    return stream;

  } catch(e1){
    // 2) fallback: pakai deviceId (lebih akurat di banyak device)
    try{
      // ini penting supaya label camera terbaca
      await ensureCamPermission();

      const deviceId = await pickCameraDeviceId(prefer === 'environment' ? 'environment' : 'user');

      if (!deviceId){
        throw e1; // tidak ada device
      }

      const constraints2 = {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height:{ ideal: 720 }
        },
        audio:false
      };

      const stream2 = await navigator.mediaDevices.getUserMedia(constraints2);
      videoEl.srcObject = stream2;
      await new Promise(r => videoEl.onloadedmetadata = r);
      return stream2;

    } catch(e2){
      // Buat pesan error yang jelas
      const name = (e2 && e2.name) ? e2.name : (e1 && e1.name) ? e1.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError'){
        throw new Error('Izin kamera ditolak. Buka setting browser → Site settings → Camera → Allow, lalu refresh.');
      }
      if (name === 'NotFoundError'){
        throw new Error('Kamera tidak ditemukan di perangkat ini.');
      }
      if (name === 'NotReadableError'){
        throw new Error('Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera/WhatsApp/Zoom lalu coba lagi.');
      }
      if (name === 'OverconstrainedError'){
        throw new Error('Kamera belakang tidak bisa dipilih (constraint tidak terpenuhi). Coba update browser atau gunakan Chrome.');
      }
      throw new Error(`Gagal membuka kamera (${name||'unknown'}). Pastikan HTTPS, izin kamera, dan perangkat mendukung kamera belakang.`);
    }
  }
}

async function switchCamera(kind, facing){
  const isPeserta = kind === 'peserta';
  const videoEl = isPeserta ? $('#video') : $('#a_video');

  const mode = (facing === 'environment') ? 'environment' : 'user';
  const stream = await startCamera(videoEl, mode);

  if (isPeserta){
    State.cam.pesertaFacing = mode;
    localStorage.setItem('cam_peserta', mode);
    State.cam.streams.peserta = stream;
  } else {
    State.cam.adminFacing = mode;
    localStorage.setItem('cam_admin', mode);
    State.cam.streams.admin = stream;
  }
}

function toggleFacing(mode){
  return (mode === 'environment') ? 'user' : 'environment';
}

async function toggleCamera(kind){
  try{
    if (kind === 'peserta'){
      const next = toggleFacing(State.cam.pesertaFacing);
      await switchCamera('peserta', next);
      UI.setResult(`Kamera: ${next === 'environment' ? 'Belakang' : 'Depan'}`, true);
    } else {
      const next = toggleFacing(State.cam.adminFacing);
      await switchCamera('admin', next);
      UI.setAdminResult(`Kamera: ${next === 'environment' ? 'Belakang' : 'Depan'}`, true);
    }
  } catch(err){
    const msg = String(err?.message || err);
    if (kind === 'peserta') UI.setResult(msg, false);
    else UI.setAdminResult(msg, false);
  }
}

async function capturePhotoDataURL(videoEl){
  const c = document.createElement('canvas');
  c.width = videoEl.videoWidth;
  c.height = videoEl.videoHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function presensiFailCam(htmlMsg){
  setPresensiFail(String(htmlMsg || 'Presensi gagal.'));
  UI.setResult(State.ui.lastFailMessage, false);

  // tampilkan overlay besar kalau kamera peserta sedang terbuka
  if (State?.ui?.pcamOpen){
    camOutcomeShow(false,
      `${State.ui.lastFailMessage}<br/><span class="small">Silakan coba lagi.</span>`,
      { delayFailMs: 2400 }
    );
  }
}

