const $ = (s, r=document) => r.querySelector(s);

const UI = {
  // pilih target result: kalau modal kamera peserta sedang tampil -> pakai result-cam
  // kalau tidak -> pakai result-main
  _resultEl(){
    const pModal = document.getElementById('pcam-modal');
    const inCam = pModal && !pModal.classList.contains('hidden');
    return document.getElementById(inCam ? 'result-cam' : 'result-main');
  },

  setStatus(text){
    const el = this._resultEl();
    if (!el) return;
    el.innerHTML = `<div class="small">${text}</div>`;
  },

  setResult(msg, ok=true){
    const el = this._resultEl();
    if (!el) return;
    el.innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'BERHASIL':'GAGAL'}</div><div class="small">${msg}</div>`;
  },

  setAdminResult(msg, ok=true){
    const el = document.getElementById('admin-result');
    if (!el) return;
    el.innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'OK':'ERROR'}</div><div class="small">${msg}</div>`;
  }
};

const State = {
  cfg: null,
  loc: { lat:null, lng:null, accuracy_m:null, distance_m:null, inFence:false },
  locCheckedAt: 0,
  locError: '',
  lastTrainingType: localStorage.getItem('lastTrainingType') || '',
  lastActivity: localStorage.getItem('lastActivity') || '',
  gateDirection: null,
  modelsReady: false,
  deviceId: null,

  adminToken: localStorage.getItem('admin_token') || '',
  adminExp: Number(localStorage.getItem('admin_exp') || 0),
  cam: {
    pesertaFacing: localStorage.getItem('cam_peserta') || 'user',   // 'user' | 'environment'
    adminFacing:   localStorage.getItem('cam_admin')   || 'user',
    streams: { peserta:null, admin:null }
  }
};

// ✅ Ganti dengan URL Deploy Web App Anda (exec)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyB8tvXIAiAt6adyy3VoR8EE2YFwmBig5tuNPOKREP4HqVGKn_swzbR_vIY8wv-fD5X/exec';

async function api(action, payload={}){
  const form = new URLSearchParams();
  form.set('action', action);
  form.set('payload', JSON.stringify(payload || {}));

  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: form
    // ⛔ jangan set header Content-Type (biarkan browser set otomatis)
    // supaya tetap "simple request" dan tidak preflight
  });

  // kalau GAS balas bukan JSON, ini akan membantu debug
  const txt = await res.text();
  try { return JSON.parse(txt); }
  catch(e){ return { ok:false, error:'Non-JSON response', raw: txt.slice(0,300) }; }
}

/* =========================
   Device ID (binding)
   ========================= */
function getOrCreateDeviceId(){
  let id = localStorage.getItem('device_id');
  if (!id){
    id = (crypto?.randomUUID?.() || (Date.now()+'-'+Math.random().toString(16).slice(2)));
    localStorage.setItem('device_id', id);
  }
  return id;
}

/* =========================================================
   ✅ BUSY / SPINNER + ANTI DOUBLE CLICK (GLOBAL)
   ========================================================= */

function setBtnLoading(btn, on, label){
  if (!btn) return;
  if (on){
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.dataset.origHtml = btn.innerHTML;
    btn.classList.add('is-loading');
    btn.disabled = true;

    const txt = label || btn.dataset.loadingLabel || 'Memproses…';
    btn.innerHTML = `<span class="btn-spin" aria-hidden="true"></span><span>${txt}</span>`;
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.dataset.busy = '0';
    btn.classList.remove('is-loading');
    btn.disabled = false;

    if (btn.dataset.origHtml) btn.innerHTML = btn.dataset.origHtml;
    btn.removeAttribute('aria-busy');
  }
}

function busyOverlay(on, text){
  const ov = document.getElementById('busy-overlay');
  const tx = document.getElementById('busy-text');
  if (!ov) return;

  if (on){
    if (tx) tx.textContent = text || 'Memproses…';
    ov.classList.remove('hidden');
    ov.setAttribute('aria-hidden', 'false');
  } else {
    ov.classList.add('hidden');
    ov.setAttribute('aria-hidden', 'true');
  }
}

const Busy = {
  async wrap(btn, fn, opts = {}){
    if (btn && btn.dataset.busy === '1') return; // anti spam click
    const label = opts.text || btn?.dataset?.loadingLabel || 'Memproses…';
    const useOverlay = !!opts.overlay;
    const overlayText = opts.overlayText || label || 'Memproses…';

    try{
      setBtnLoading(btn, true, label);
      if (useOverlay) busyOverlay(true, overlayText);
      return await fn();
    } finally {
      if (useOverlay) busyOverlay(false);
      setBtnLoading(btn, false);
    }
  }
};

// mutex sederhana
function runExclusive(key, fn){
  State._locks = State._locks || {};
  if (State._locks[key]) return Promise.resolve(null);
  State._locks[key] = true;
  return (async()=>{
    try { return await fn(); }
    finally { State._locks[key] = false; }
  })();
}

/* =========================
   Face-api models
   ========================= */
async function loadModels(){
  // ✅ weights repo yang benar (ada manifest + shard)
  const base = 'https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js@0.22.2/weights';

  await faceapi.nets.tinyFaceDetector.loadFromUri(base);
  await faceapi.nets.faceLandmark68Net.loadFromUri(base);
  await faceapi.nets.faceRecognitionNet.loadFromUri(base);

  State.modelsReady = true;
}

async function detectOnce(videoEl){
  return faceapi
    .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
}

function avgDescriptors(descs){
  const n = descs.length;
  const m = descs[0].length;
  const out = new Array(m).fill(0);
  for (const d of descs){
    for (let i=0;i<m;i++) out[i] += Number(d[i]);
  }
  for (let i=0;i<m;i++) out[i] /= n;
  return out;
}

/* =========================
   Multi-shot capture
   - enroll: 5 shot
   - verify: 3 shot
   ========================= */
async function captureMultiShotAvg(videoEl, shots=3, intervalMs=250, maxTries=20){
  if (!State.modelsReady) await loadModels();

  const got = [];
  let tries = 0;
  while (got.length < shots && tries < maxTries){
    tries++;
    const det = await detectOnce(videoEl);
    if (det && det.descriptor){
      got.push(Array.from(det.descriptor));
      await sleep(intervalMs);
    } else {
      await sleep(120);
    }
  }
  if (got.length < shots) return null;
  return avgDescriptors(got);
}

/* =========================
   LIVENESS CHECK (simple)
   - challenge random: blink OR head turn
   ========================= */
function eyeEAR(eyePts){
  // eyePts: 6 points
  const dist = (p,q)=> Math.hypot(p.x-q.x, p.y-q.y);
  const A = dist(eyePts[1], eyePts[5]);
  const B = dist(eyePts[2], eyePts[4]);
  const C = dist(eyePts[0], eyePts[3]);
  return (A + B) / (2.0 * C);
}

function headTurnScore(landmarks){
  // deteksi turn sederhana via posisi nose relative ke midpoint eye
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();

  const midEyeX = (leftEye[0].x + rightEye[3].x) / 2;
  const eyeDist = Math.abs(rightEye[3].x - leftEye[0].x) || 1;
  const noseTip = nose[3] || nose[Math.floor(nose.length/2)];

  // positif = condong kanan, negatif = condong kiri
  return (noseTip.x - midEyeX) / eyeDist;
}

function getLivenessCfg(){
  const def = {
    enabled: true,
    mode: 'both',          // 'blink' | 'turn' | 'both'
    ear_low: 0.18,
    ear_high: 0.23,
    turn_thresh: 0.18,
    duration_ms: 3500
  };
  const L = (State.cfg && State.cfg.liveness) ? State.cfg.liveness : null;
  if (!L) return def;

  return {
    enabled: String(L.enabled ?? 'TRUE').toUpperCase() !== 'FALSE',
    mode: String(L.mode || 'both').toLowerCase(),
    ear_low: Number(L.ear_low ?? def.ear_low),
    ear_high: Number(L.ear_high ?? def.ear_high),
    turn_thresh: Number(L.turn_thresh ?? def.turn_thresh),
    duration_ms: Number(L.duration_ms ?? def.duration_ms)
  };
}

/* =========================
   DEVICE DETECTION CFG
   ========================= */
function getDeviceDetectCfg(){
  const def = { enabled: true };
  const D = (State.cfg && State.cfg.device_detect) ? State.cfg.device_detect : null;
  if (!D) return def;

  return {
    enabled: String(D.enabled ?? 'TRUE').toUpperCase() !== 'FALSE'
  };
}

async function runLiveness(videoEl, durationMs){
  if (!State.modelsReady) await loadModels();

  const cfg = getLivenessCfg();
  const dur = Number(durationMs || cfg.duration_ms || 3500);

  // jika dimatikan dari server
  if (!cfg.enabled){
    UI.setResult('Liveness dimatikan oleh admin. (Skip)', true);
    return { ok:true, type:'disabled', info:{ enabled:false } };
  }

  // tentukan challenge sesuai mode
  let challenge = 'blink';
  if (cfg.mode === 'blink') {
    challenge = 'blink';
  } else if (cfg.mode === 'turn') {
    challenge = (Math.random() < 0.5) ? 'turn_left' : 'turn_right';
  } else {
    // both
    challenge = (Math.random() < 0.5) ? 'blink' : ((Math.random() < 0.5) ? 'turn_left' : 'turn_right');
  }

  UI.setResult(
    `Liveness: ${
      challenge === 'blink' ? 'KEDIPKAN mata'
      : (challenge === 'turn_left' ? 'Putar kepala KIRI' : 'Putar kepala KANAN')
    }…`,
    true
  );

  const start = Date.now();
  let blinked = false;
  let earLowSeen = false;
  let turned = false;

  const EAR_LOW = cfg.ear_low;
  const EAR_HIGH = cfg.ear_high;
  const TURN_THRESH = cfg.turn_thresh;

  while (Date.now() - start < dur){
    const det = await detectOnce(videoEl);
    if (!det || !det.landmarks){
      await sleep(80);
      continue;
    }

    const lm = det.landmarks;

    // blink
    const leftEAR = eyeEAR(lm.getLeftEye());
    const rightEAR = eyeEAR(lm.getRightEye());
    const ear = (leftEAR + rightEAR)/2;

    if (ear < EAR_LOW) earLowSeen = true;
    if (earLowSeen && ear > EAR_HIGH) blinked = true;

    // turn
    const score = headTurnScore(lm);
    if (challenge === 'turn_left' && score < -TURN_THRESH) turned = true;
    if (challenge === 'turn_right' && score > TURN_THRESH) turned = true;

    if (challenge === 'blink' && blinked) {
      return { ok:true, type:'blink', info:{ ear, cfg } };
    }
    if (challenge !== 'blink' && turned) {
      return { ok:true, type:'turn', info:{ dir: challenge, score, cfg } };
    }

    await sleep(90);
  }

  return { ok:false, type:'timeout', info:{ challenge, cfg } };
}

/* =========================
   Geo + Config
   ========================= */
async function loadConfig(force=false){
  if (!force && State.cfg && State.cfg.ok) return;
  const r = await api('config', { t: Date.now() }); // cache buster
  if (r.ok) State.cfg = r;
}

function haversineM(lat1,lng1,lat2,lng2){
  const R=6371000;
  const toRad = x => x*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLng=toRad(lng2-lng1);
  const A = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  const C = 2*Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
  return R*C;
}

function updateLocPill(){
  const pill = $('#loc-status');
  const L = State.loc;

  // ✅ jika ada error lokasi (izin ditolak, timeout, dll)
  if (State.locError){
    pill.textContent = 'Lokasi belum diizinkan / error';
    pill.style.borderStyle = 'dashed';
    return;
  }

  if (!isFinite(L.distance_m)){
    pill.textContent = 'Sedang cek lokasi…';
    pill.style.borderStyle = 'dashed';
    return;
  }

  pill.textContent = L.inFence
    ? `Di area (${Math.round(L.distance_m)} m)`
    : `Di luar area (${Math.round(L.distance_m)} m)`;

  pill.style.borderStyle = 'solid';
}

function getLocation({ maximumAge=15000 } = {}){
  return new Promise((resolve, reject)=>{
    if (!navigator.geolocation) return reject(new Error('Geolocation tidak didukung'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge
    });
  });
}

/**
 * checkLocation(opts)
 * - force: paksa ambil GPS baru
 * - silent: jangan throw ke UI (dipakai saat auto-check on load)
 * - maxAgeMs: cache umur GPS yg boleh dipakai
 */
async function checkLocation(opts = {}){
  const force = !!opts.force;
  const silent = !!opts.silent;
  const maxAgeMs = Number(opts.maxAgeMs ?? 45000); // ✅ cache singkat 45 detik

  try{
    await loadConfig(true);

    // ✅ gunakan hasil terakhir kalau masih fresh (menghindari prompt/ambil ulang)
    const age = Date.now() - (State.locCheckedAt || 0);
    if (!force && isFinite(State.loc.distance_m) && age < maxAgeMs){
      updateLocPill();
      validateEnablePresensi();
      return State.loc;
    }

    const pos = await getLocation({ maximumAge: force ? 0 : Math.min(maxAgeMs, 30000) });

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = pos.coords.accuracy || 0;

    const c = State.cfg.geofence.center;
    const d = haversineM(c.lat, c.lng, lat, lng);
    const inFence = d <= State.cfg.geofence.radius_m;

    State.loc = { lat, lng, accuracy_m:acc, distance_m:d, inFence };
    State.locCheckedAt = Date.now();
    State.locError = '';

    updateLocPill();
    validateEnablePresensi();
    return State.loc;

  } catch(err){
    const msg = String(err?.message || err || 'Gagal cek lokasi');

    // ✅ simpan error agar UI tahu statusnya
    State.locError = msg;

    // update pill agar user paham kenapa belum siap
    const pill = $('#loc-status');
    if (pill){
      pill.textContent = 'Lokasi belum tersedia';
      pill.style.borderStyle = 'dashed';
    }
    validateEnablePresensi();

    if (!silent) throw err;
    return null;
  }
}

/* =========================
   UI mode & validation
   ========================= */
function toggleMaterial(){
  const act = ($('#activity').value || '').toLowerCase();
  const need = (act === 'sesi kelas' || act === 'field day');
  $('#material-wrap').style.display = need ? 'block' : 'none';
  if (!need){ $('#material').value=''; $('#suggest').innerHTML=''; }
}

function togglePesertaCameraBox(){
  const mode = ($('#mode')?.value || 'training');
  const box = $('#pcam-box');
  if (!box) return;

  // ✅ Gate: sembunyikan box kamera "Buka Kamera"
  // ✅ Training: tampilkan kembali
  box.style.display = (mode === 'gate') ? 'none' : '';
}

function validateEnablePresensi(){
  const mode = $('#mode').value;
  const readyLoc = isFinite(State.loc.distance_m) && State.loc.inFence;
  let ok = readyLoc;

  if (mode === 'training'){
    const tt = ($('#training_type').value || '').trim();
    const act = ($('#activity').value || '').trim();
    if (!tt || !act) ok = false;

    const needMaterial = (act.toLowerCase() === 'sesi kelas' || act.toLowerCase() === 'field day');
    if (needMaterial && !($('#material').value || '').trim()) ok = false;

  } else {
    const reason = ($('#gate_reason').value || '').trim();
    if (!reason) ok = false;

    // ✅ Mobilitas wajib pilih arah (Masuk/Keluar) dulu
    if (!State.gateDirection) ok = false;
  }

  $('#btn-presensi').disabled = !ok;
  return ok; // ✅ penting: supaya bisa dipakai untuk pesan status
}

function updatePresensiReadyMessage(){
  // Catatan: fungsi ini hanya untuk status umum (bukan saat proses presensi sedang berjalan)

  // 1) lokasi error (izin ditolak / timeout / dll)
  if (State.locError){
    UI.setResult('Belum siap melakukan presensi karena izin lokasi belum aktif. Klik "Cek Lokasi" lalu izinkan GPS.', false);
    return false;
  }

  // 2) lokasi belum pernah terukur
  if (!isFinite(State.loc.distance_m)){
    UI.setResult('Belum siap melakukan presensi. Lokasi belum terdeteksi, silakan klik "Cek Lokasi".', false);
    return false;
  }

  // 3) di luar geofence
  if (!State.loc.inFence){
    UI.setResult(`Belum siap melakukan presensi karena di luar area (${Math.round(State.loc.distance_m)} m).`, false);
    return false;
  }

  // 4) lokasi OK, cek kelengkapan form/mode
  const ok = validateEnablePresensi();
  if (ok){
    UI.setResult('Siap melakukan presensi.', true);
    return true;
  } else {
    UI.setResult('Belum siap melakukan presensi. Lengkapi pilihan (Training Type/Activity/Materi atau Mobilitas) terlebih dahulu.', false);
    return false;
  }
}

/* =========================
   Badge indikator konteks scan (di modal kamera peserta)
   ========================= */
function setScanBadge(text, tone='neutral'){
  const el = $('#scan-badge');
  if (!el) return;
  el.textContent = text;

  // reset class tone
  el.classList.remove('neutral','ok','warn','danger');
  el.classList.add(tone);
}

function updateScanBadge(){
  const mode = ($('#mode')?.value || 'training');

  if (mode === 'training'){
    const tt = ($('#training_type')?.value || '').trim();
    const act = ($('#activity')?.value || '').trim();

    const label = `TRAINING${tt ? ': '+tt : ''}${act ? ' / '+act : ''}`;
    setScanBadge(label, 'ok');
    return;
  }

  // gate / mobilitas
  if (!State.gateDirection){
    setScanBadge('MOBILITAS: PILIH ARAH', 'warn');
    return;
  }

  const dir = (State.gateDirection === 'IN') ? 'MASUK' : 'KELUAR';
  setScanBadge(`MOBILITAS: ${dir}`, State.gateDirection === 'IN' ? 'ok' : 'danger');
}

/* =========================
   Materials suggest
   ========================= */
function debounce(fn, ms){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

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

/* =========================
   PRESENSI FLOW (peserta)
   1) checkLocation
   2) liveness (blink/turn)
   3) multi-shot avg (3)
   4) send verifyAndLog (device_id included)
   ========================= */
async function doPresensi(){
  return runExclusive('presensi', async()=>{
    try{
        // ✅ jika izin lokasi belum ada / error, minta user keluar fullscreen dulu
        if (State.locError && document.fullscreenElement){
        UI.setResult('Izin lokasi belum aktif. Tutup fullscreen lalu klik "Cek Lokasi" terlebih dahulu.', false);
        return;
        }
      await checkLocation({ force:false, silent:false, maxAgeMs:45000 });
      if (!State.loc.inFence){
        UI.setResult('Anda di luar area geo-fence. Dekati area Training Center.', false);
        return;
      }

      const mode = $('#mode').value;
      const payload = {
        mode,
        lat: State.loc.lat,
        lng: State.loc.lng,
        accuracy_m: State.loc.accuracy_m,
        device_id: State.deviceId
      };

      if (mode === 'training'){
        payload.training_type = $('#training_type').value || '';
        payload.activity = $('#activity').value || '';
        payload.material = $('#material').value || '';
      } else {
        payload.gate_reason = $('#gate_reason').value || '';
        payload.gate_direction = State.gateDirection || '';
        if (!payload.gate_direction){
          UI.setResult('Silakan gunakan tombol Masuk atau Keluar.', false);
          return;
        }
      }

      // liveness
      const live = await runLiveness($('#video'));
      if (!live.ok){
        UI.setResult('Liveness gagal. Coba lagi (cahaya cukup, wajah penuh di kamera).', false);
        payload.liveness = live;
        return;
      }
      payload.liveness = live;

      UI.setResult('Memindai wajah (multi-shot)…', true);

      const descAvg = await captureMultiShotAvg($('#video'), 3, 220, 30);
      if (!descAvg){
        UI.setResult('Wajah tidak stabil terdeteksi. Coba lagi.', false);
        return;
      }
      payload.descriptor_avg = descAvg;

      const r = await api('verifyAndLog', payload);

        if (r.ok){
        UI.setResult(
            `Presensi diterima: <b>${escapeHtml(r.nama)}</b> (NIK: ${escapeHtml(r.nik)})<br/>
            Jarak center: ${Math.round(r.distance_m)} m<br/>
            Deteksi Device: <b>${r.device_detect_enabled ? 'ON' : 'OFF'}</b> • Status: <b>${escapeHtml(r.status || '')}</b><br/>
            ${r.device_bound ? '✅ Device berhasil diikat (binding) pertama kali.' : ''}`,
            true
        );
        } else {
        // ✅ Khusus duplicate attempt
        if (String(r.status || '').toUpperCase() === 'DUPLICATE_ATTEMPT'){
            UI.setResult(
            `Presensi duplikat terdeteksi.<br/>
            Jika barusan sudah presensi, tidak perlu ulang. (Anti-Duplicate Aktif)`,
            false
            );
            return;
        }

        UI.setResult(`${escapeHtml(r.error || 'Gagal')}<br/>Status: ${escapeHtml(r.status || '-')}`, false);
        }
    } catch(err){
      UI.setResult(String(err?.message || err), false);
    } finally {
      State.gateDirection = null;
      updateScanBadge();
    }
  });
}

/* =========================
   ENROLL FLOW (admin)
   - multi-shot 5 avg
   - photo saved
   ========================= */
async function doEnroll(){
  return runExclusive('enroll', async()=>{
    try{
      if (!isAdminSessionValid()){
        UI.setAdminResult('Admin belum login / sesi habis. Login ulang.', false);
        return;
      }

      const nik = ($('#a_nik').value || '').trim();
      const nama = ($('#a_nama').value || '').trim();
      const bio  = ($('#a_bio').value || '').trim();
      const note = ($('#a_note').value || '').trim();
      if (!nik || !nama){
        UI.setAdminResult('NIK dan Nama wajib.', false);
        return;
      }

      UI.setAdminResult('Rekam wajah (multi-shot 5x)… jangan banyak bergerak.', true);

      const descAvg = await captureMultiShotAvg($('#a_video'), 5, 220, 45);
      if (!descAvg){
        UI.setAdminResult('Gagal menangkap 5 shot wajah. Pastikan cahaya dan wajah jelas.', false);
        return;
      }

      const photo = await capturePhotoDataURL($('#a_video'));

      const r = await api('enroll', {
        admin_token: State.adminToken,
        nik, nama,
        biodata: { bio, note },
        descriptor_avg: descAvg,
        photo_base64: photo
      });

      if (r.ok){
        UI.setAdminResult(`Tersimpan: <b>${escapeHtml(r.nama)}</b> (NIK: ${escapeHtml(r.nik)})`, true);
      } else {
        UI.setAdminResult(r.error || 'Gagal enroll', false);
      }
    } catch(err){
      if (handleAdminAuthError_(err)) return;
      UI.setAdminResult(String(err?.message || err), false);
    }
  });
}

/* =========================
   Admin: Login/Session
   ========================= */
function isAdminSessionValid(){
  return !!State.adminToken && Date.now() < State.adminExp;
}

function forceAdminRelogin(msg){
  State.adminToken = '';
  State.adminExp = 0;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_exp');

  UI.setAdminResult(msg || 'Sesi admin tidak valid. Silakan login ulang.', false);

  // balikkan UI ke pane login jika modal sedang terbuka
  try{
    const paneAdmin = $('#admin-pane');
    const paneLogin = $('#admin-login-pane');
    if (paneAdmin) paneAdmin.classList.add('hidden');
    if (paneLogin) paneLogin.classList.remove('hidden');

    const btnLogout = $('#btn-admin-logout');
    if (btnLogout) btnLogout.disabled = true;

    const ses = $('#admin-session');
    if (ses) ses.textContent = '';
  } catch(e){}
}

function handleAdminAuthError_(err){
  const m = String(err?.message || err || '');
  if (/Token admin tidak valid|Sesi admin habis|Admin token missing|Admin belum login/i.test(m)){
    forceAdminRelogin(m);
    return true;
  }
  return false;
}

async function adminLogin(){
  const pin = ($('#admin-pin').value || '').trim();
  if (!pin){ $('#admin-session').textContent = 'PIN wajib diisi'; return; }

  const r = await api('adminLogin', { pin });
  if (!r.ok){
    $('#admin-session').textContent = r.error || 'Login gagal';
    return;
  }

  State.adminToken = r.token;
  State.adminExp = Number(r.exp || 0);

  localStorage.setItem('admin_token', State.adminToken);
  localStorage.setItem('admin_exp', String(State.adminExp));

  $('#admin-session').textContent = `Login OK. Exp: ${new Date(State.adminExp).toLocaleString()}`;
  $('#btn-admin-logout').disabled = false;

  $('#admin-login-pane').classList.add('hidden');
  $('#admin-pane').classList.remove('hidden');
}

function adminLogout(){
  State.adminToken = '';
  State.adminExp = 0;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_exp');
  $('#admin-session').textContent = 'Silahkan masukkan PIN dan klik Login';
  $('#btn-admin-logout').disabled = true;

  $('#admin-pane').classList.add('hidden');
  $('#admin-login-pane').classList.remove('hidden');
}

/* =========================
   Admin: Rekap / Logs / Export
   ========================= */
function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

async function adminRekap(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const start = $('#r_start').value || todayISO();
    const end   = $('#r_end').value   || todayISO();

    const r = await api('adminSummary', { admin_token: State.adminToken, start, end });
    if (!r.ok) throw new Error(r.error || 'Gagal ambil rekap');

    $('#rekap-summary').textContent = `Range: ${r.range.start} s/d ${r.range.end} | Total: ${r.total}`;

    $('#rekap-status').innerHTML = Object.entries(r.byStatus||{})
      .map(([k,v])=>`• ${escapeHtml(k)}: <b>${v}</b>`).join('<br/>') || '-';

    $('#rekap-activity').innerHTML = Object.entries(r.byActivity||{})
      .map(([k,v])=>`• ${escapeHtml(k)}: <b>${v}</b>`).join('<br/>') || '-';
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    $('#rekap-summary').textContent = String(e.message || e);
  }
}

async function adminLogs(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const start = $('#l_start').value || todayISO();
    const end   = $('#l_end').value   || todayISO();
    const limit = Number($('#l_limit').value || 200);

    const r = await api('adminLogs', { admin_token: State.adminToken, start, end, limit });
    if (!r.ok) throw new Error(r.error || 'Gagal ambil logs');

    const tbody = $('#logs-table tbody');
    tbody.innerHTML = r.rows.map(x => `
      <tr>
        <td>${escapeHtml(x.timestamp)}</td>
        <td>${escapeHtml(x.nik)}</td>
        <td>${escapeHtml(x.nama)}</td>
        <td>${escapeHtml(x.mode)}</td>
        <td>${escapeHtml(x.activity)}</td>
        <td>${escapeHtml(x.material)}</td>
        <td>${escapeHtml((x.gate_direction||'') + (x.gate_reason?(' - '+x.gate_reason):''))}</td>
        <td>${escapeHtml(x.status)}</td>
        <td>${escapeHtml(String(x.distance_m||''))}</td>
      </tr>
    `).join('');
    } catch(e){
    if (handleAdminAuthError_(e)) return;
    alert(String(e.message || e));
  }
}

async function adminExportCsv(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const start = $('#r_start').value || todayISO();
    const end   = $('#r_end').value   || todayISO();

    const r = await api('adminExportCsv', { admin_token: State.adminToken, start, end });
    if (!r.ok) throw new Error(r.error || 'Export gagal');

    const blob = new Blob([r.csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = r.filename || 'attendance.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    } catch(e){
    if (handleAdminAuthError_(e)) return;
    alert(String(e.message || e));
  }
}

/* =========================
   Admin: SETTINGS (geofence + threshold) & PIN
   ========================= */
async function adminLoadSettings(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const r = await api('config', {}); // config selalu public tapi berisi nilai settings terbaru
    if (!r.ok) throw new Error(r.error || 'Gagal load config');

    $('#s_lat').value = Number(r.geofence?.center?.lat ?? '');
    $('#s_lng').value = Number(r.geofence?.center?.lng ?? '');
    $('#s_radius').value = Number(r.geofence?.radius_m ?? '');
    $('#s_threshold').value = Number(r.threshold ?? '');

        // liveness
    const L = r.liveness || {};
    $('#s_live_enabled').value = (String(L.enabled ?? 'TRUE').toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';
    $('#s_live_mode').value = String(L.mode || 'both').toLowerCase();

    $('#s_ear_low').value = Number(L.ear_low ?? 0.18);
    $('#s_ear_high').value = Number(L.ear_high ?? 0.23);
    $('#s_turn_thresh').value = Number(L.turn_thresh ?? 0.18);
    $('#s_live_duration').value = Number(L.duration_ms ?? 3500);

        // ✅ device detect
    const D = r.device_detect || {};
    $('#s_devdet_enabled').value = (String(D.enabled ?? 'TRUE').toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';

    $('#settings-info').textContent = `Loaded: ${new Date().toLocaleString()}`;
  } catch(e){
    $('#settings-info').textContent = String(e.message || e);
  }
}

async function adminSaveSettings(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const geofence_lat = Number($('#s_lat').value);
    const geofence_lng = Number($('#s_lng').value);
    const geofence_radius_m = Number($('#s_radius').value);
    const face_threshold = Number($('#s_threshold').value);

    const liveness_enabled = ($('#s_live_enabled').value || 'TRUE') === 'TRUE';
    const liveness_mode = ($('#s_live_mode').value || 'both');

    const ear_low = Number($('#s_ear_low').value);
    const ear_high = Number($('#s_ear_high').value);
    const turn_thresh = Number($('#s_turn_thresh').value);
    const liveness_duration_ms = Number($('#s_live_duration').value);

    // ✅ FIX UTAMA: definisikan variabelnya dulu (sebelumnya tidak ada)
    const device_detect_enabled = ($('#s_devdet_enabled').value || 'TRUE') === 'TRUE';

    const r = await api('adminUpdateSettings', {
      admin_token: State.adminToken,
      geofence_lat, geofence_lng, geofence_radius_m,
      face_threshold,
      liveness_enabled,
      liveness_mode,
      ear_low, ear_high,
      turn_thresh,
      liveness_duration_ms,

      // ✅ nama field ini sesuai backend (adminUpdateSettings_ membaca body.device_detect_enabled)
      device_detect_enabled
    });

    if (!r.ok) throw new Error(r.error || 'Gagal simpan settings');

    // update State.cfg agar checkLocation pakai nilai terbaru tanpa reload page
    if (r.cfg) State.cfg = { ok:true, ...r.cfg };

    $('#settings-info').textContent = `✅ Tersimpan: ${new Date().toLocaleString()}`;
    UI.setAdminResult('Settings berhasil disimpan.', true);

  } catch(e){
    if (handleAdminAuthError_(e)) return;

    const m = String(e.message || e);
    $('#settings-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

async function adminChangePin(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const old_pin = ($('#pin_old').value || '').trim();
    const new_pin = ($('#pin_new').value || '').trim();
    const new2    = ($('#pin_new2').value || '').trim();

    if (!old_pin || !new_pin) throw new Error('PIN lama & PIN baru wajib diisi.');
    if (new_pin.length < 4) throw new Error('PIN baru minimal 4 karakter.');
    if (new_pin !== new2) throw new Error('Konfirmasi PIN baru tidak sama.');

    const r = await api('adminChangePin', { admin_token: State.adminToken, old_pin, new_pin });
    if (!r.ok) throw new Error(r.error || 'Gagal ganti PIN');

    $('#pin_old').value = '';
    $('#pin_new').value = '';
    $('#pin_new2').value = '';
    $('#pin-info').textContent = '✅ PIN berhasil diperbarui.';
    UI.setAdminResult('PIN berhasil diperbarui.', true);
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    const m = String(e.message || e);
    $('#pin-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

/* =========================
   Admin: MATERI CRUD
   ========================= */
function resetMateriForm(){
  $('#m_id').value = '';
  $('#m_name').value = '';
  $('#m_tags').value = '';
  $('#m_active').value = 'TRUE';
}

function renderMateriTable(items){
  const tbody = $('#materi-table tbody');
  tbody.innerHTML = (items || []).map(x => `
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>${escapeHtml(x.tags || '')}</td>
      <td>${escapeHtml(String(x.active))}</td>
      <td>
        <button class="btn" data-act="edit" data-id="${escapeHtml(x.id)}">Edit</button>
        <button class="btn danger" data-act="del" data-id="${escapeHtml(x.id)}">Hapus</button>
      </td>
    </tr>
  `).join('');

  // bind actions
  tbody.querySelectorAll('button[data-act="edit"]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.dataset.id;
      const it = (items || []).find(z => z.id === id);
      if (!it) return;
      $('#m_id').value = it.id;
      $('#m_name').value = it.name;
      $('#m_tags').value = it.tags || '';
      $('#m_active').value = it.active ? 'TRUE' : 'FALSE';
      $('#materi-info').textContent = `Edit: ${it.id}`;
    });
  });

  tbody.querySelectorAll('button[data-act="del"]').forEach(b=>{
    b.addEventListener('click', async()=>{
      const id = b.dataset.id;
      if (!confirm('Hapus materi ini?')) return;
      await adminDeleteMateri(id);
    });
  });
}

async function adminLoadMateri(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const r = await api('adminMaterialsList', { admin_token: State.adminToken });
    if (!r.ok) throw new Error(r.error || 'Gagal load materi');

    State._materiItems = r.items || [];
    renderMateriTable(State._materiItems);
    $('#materi-info').textContent = `Loaded: ${State._materiItems.length} item`;

  } catch(e){
    if (handleAdminAuthError_(e)) return;

    const m = String(e.message || e);
    $('#materi-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

async function adminSaveMateri(){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

    const id = ($('#m_id').value || '').trim();
    const name = ($('#m_name').value || '').trim();
    const tags = ($('#m_tags').value || '').trim();
    const active = ($('#m_active').value || 'TRUE') === 'TRUE';

    const r = await api('adminMaterialsUpsert', { admin_token: State.adminToken, id, name, tags, active });
    if (!r.ok) throw new Error(r.error || 'Gagal simpan materi');

    $('#materi-info').textContent = `✅ Tersimpan: ${r.id}`;
    resetMateriForm();
    await adminLoadMateri(); // refresh
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    const m = String(e.message || e);
    $('#materi-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

async function adminDeleteMateri(id){
  try{
    if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
    const r = await api('adminMaterialsDelete', { admin_token: State.adminToken, id });
    if (!r.ok) throw new Error(r.error || 'Gagal hapus');

    $('#materi-info').textContent = '✅ ' + (r.message || 'Terhapus');
    await adminLoadMateri();
  } catch(e){
    if (handleAdminAuthError_(e)) return;
    const m = String(e.message || e);
    $('#materi-info').textContent = '❌ ' + m;
    UI.setAdminResult(m, false);
  }
}

/* =========================
   Init UI
   ========================= */
function initMode(){
  const mode = $('#mode');
  const trainingBox = $('#training-fields');
  const gateBox = $('#gate-fields');

    function refresh(){
    const v = mode.value;
    if (v === 'training'){
      trainingBox.classList.remove('hidden');
      gateBox.classList.add('hidden');
      State.gateDirection = null; // ✅ reset saat pindah ke training
    } else {
      gateBox.classList.remove('hidden');
      trainingBox.classList.add('hidden');
      // di mobilitas, arah akan ditentukan lewat tombol Masuk/Keluar
    }
    togglePesertaCameraBox();
    validateEnablePresensi();
    updateScanBadge();
  }
  mode.addEventListener('change', refresh);
  refresh();

  document.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{ $('#gate_reason').value = ch.dataset.reason; validateEnablePresensi(); });
  });

    $('#btn-in').addEventListener('click', async()=>{
    State.gateDirection = 'IN';
    validateEnablePresensi();
    updateScanBadge();
    await openPesertaCameraModal(); // ✅ buka kamera full-screen
    UI.setResult('Mobilitas: MASUK. Pastikan wajah jelas lalu tekan Presensi.', true);
  });

  $('#btn-out').addEventListener('click', async()=>{
    State.gateDirection = 'OUT';
    validateEnablePresensi();
    updateScanBadge();
    await openPesertaCameraModal(); // ✅ buka kamera full-screen
    UI.setResult('Mobilitas: KELUAR. Pastikan wajah jelas lalu tekan Presensi.', true);
  });
}

function initTraining(){
  const t = $('#training_type');
  const a = $('#activity');

  if (State.lastTrainingType) t.value = State.lastTrainingType;
  if (State.lastActivity) a.value = State.lastActivity;

  t.addEventListener('change', ()=>{
    localStorage.setItem('lastTrainingType', t.value||'');
    updateScanBadge();
    validateEnablePresensi();
  });

  a.addEventListener('change', ()=>{
    localStorage.setItem('lastActivity', a.value||'');
    toggleMaterial();
    updateScanBadge();
    validateEnablePresensi();
  });

  $('#material').addEventListener('input', debounce(async(ev)=>{
    const q = ev.target.value.trim();
    if (!q){ $('#suggest').innerHTML=''; validateEnablePresensi(); return; }
    const r = await api('materialsSuggest', { q });
    if (!r.ok) return;
    $('#suggest').innerHTML = r.items.map(x=>`<button type="button" data-val="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('');
    $('#suggest').querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>{
        $('#material').value = b.dataset.val;
        $('#suggest').innerHTML='';
        validateEnablePresensi();
      });
    });
    validateEnablePresensi();
  }, 250));

  toggleMaterial();
}

function initAdminModal(){
  const modal = $('#admin-modal');
  $('#btn-admin-open').addEventListener('click', ()=>{
    show(modal);

    // restore session UI
    if (isAdminSessionValid()){
      $('#admin-login-pane').classList.add('hidden');
      $('#admin-pane').classList.remove('hidden');
      $('#admin-session').textContent = `Login OK. Exp: ${new Date(State.adminExp).toLocaleString()}`;
      $('#btn-admin-logout').disabled = false;
    // auto load settings & materi
      adminLoadSettings();
      adminLoadMateri();
      dashTodayDefaults();
      initDashboardMeta();
    } else {
      $('#admin-pane').classList.add('hidden');
      $('#admin-login-pane').classList.remove('hidden');
      $('#btn-admin-logout').disabled = true;
      $('#admin-session').textContent = '';
    }
  });
  $('#btn-admin-close').addEventListener('click', ()=> hide(modal));
  modal.addEventListener('click', (e)=>{ if (e.target === modal) hide(modal); });

    // camera toggle admin (enroll)
    const btnAdminRotate = $('#btn-a-cam-rotate');
  if (btnAdminRotate){
    btnAdminRotate.addEventListener('click', ()=> toggleCamera('admin'));
  }


  $('#btn-admin-login').addEventListener('click', adminLogin);
  $('#btn-admin-logout').addEventListener('click', adminLogout);

  // admin tabs
  document.querySelectorAll('.tab2').forEach(t=>{
    t.addEventListener('click', ()=>{
      document.querySelectorAll('.tab2').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.dataset.atab;
      document.querySelectorAll('.apane').forEach(p=>p.classList.remove('active'));
      $('#apane-'+tab).classList.add('active');
    });
  });

  // default date
  const today = todayISO();
  ['r_start','r_end','l_start','l_end'].forEach(id=>{ const el = $('#'+id); if (el) el.value = today; });

    // actions
    $('#btn-enroll').addEventListener('click', ()=> Busy.wrap(
    $('#btn-enroll'),
    async()=> await doEnroll(),
    { text:'Menyimpan…', overlay:true, overlayText:'Enroll: Simpan + Rekam Wajah…' }
    ));

    $('#btn-rekap').addEventListener('click', ()=> Busy.wrap(
    $('#btn-rekap'),
    async()=> await adminRekap(),
    { text:'Mengambil…', overlay:true, overlayText:'Mengambil Rekap…' }
    ));

    $('#btn-logs').addEventListener('click', ()=> Busy.wrap(
    $('#btn-logs'),
    async()=> await adminLogs(),
    { text:'Mengambil…', overlay:true, overlayText:'Mengambil Logs…' }
    ));

    $('#btn-export').addEventListener('click', ()=> Busy.wrap(
    $('#btn-export'),
    async()=> await adminExportCsv(),
    { text:'Export…', overlay:true, overlayText:'Menyiapkan file CSV…' }
    ));

      // ✅ Dashboard buttons
    $('#btn-d-preview')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-d-preview'),
        async()=> await adminPreviewTraining(),
        { text:'Memuat…', overlay:true, overlayText:'Menyusun Daftar Hadir…' }
    ));

    $('#btn-d-xlsx')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-d-xlsx'),
        async()=> await adminExportDashboard('xlsx','training'),
        { text:'Export…', overlay:true, overlayText:'Menyiapkan XLSX Daftar Hadir…' }
    ));

    $('#btn-d-pdf')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-d-pdf'),
        async()=> await adminExportDashboard('pdf','training'),
        { text:'PDF…', overlay:true, overlayText:'Menyiapkan PDF Daftar Hadir…' }
    ));

    $('#btn-g-preview')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-g-preview'),
        async()=> await adminPreviewGate(),
        { text:'Memuat…', overlay:true, overlayText:'Menyusun Laporan Mobilitas…' }
    ));

    $('#btn-g-xlsx')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-g-xlsx'),
        async()=> await adminExportDashboard('xlsx','gate'),
        { text:'Export…', overlay:true, overlayText:'Menyiapkan XLSX Mobilitas…' }
    ));

    $('#btn-g-pdf')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-g-pdf'),
        async()=> await adminExportDashboard('pdf','gate'),
        { text:'PDF…', overlay:true, overlayText:'Menyiapkan PDF Mobilitas…' }
    ));

    // toggle view mobilitas
    bindGateViewToggle();

  // settings
    $('#btn-save-settings').addEventListener('click', ()=> Busy.wrap(
    $('#btn-save-settings'),
    async()=> await adminSaveSettings(),
    { text:'Menyimpan…', overlay:true, overlayText:'Menyimpan Settings…' }
    ));

    $('#btn-reload-settings').addEventListener('click', ()=> Busy.wrap(
    $('#btn-reload-settings'),
    async()=> await adminLoadSettings(),
    { text:'Reload…', overlay:true, overlayText:'Reload Settings…' }
    ));

    $('#btn-change-pin').addEventListener('click', ()=> Busy.wrap(
    $('#btn-change-pin'),
    async()=> await adminChangePin(),
    { text:'Menyimpan…', overlay:true, overlayText:'Menyimpan PIN Baru…' }
    ));

  // materi CRUD
    $('#btn-m-refresh').addEventListener('click', ()=> Busy.wrap(
    $('#btn-m-refresh'),
    async()=> await adminLoadMateri(),
    { text:'Refresh…', overlay:true, overlayText:'Memuat daftar materi…' }
    ));

    $('#btn-m-save').addEventListener('click', ()=> Busy.wrap(
    $('#btn-m-save'),
    async()=> await adminSaveMateri(),
    { text:'Menyimpan…', overlay:true, overlayText:'Menyimpan materi…' }
    ));

    $('#btn-m-reset').addEventListener('click', ()=> Busy.wrap(
    $('#btn-m-reset'),
    async()=>{ resetMateriForm(); $('#materi-info').textContent='-'; },
    { text:'Reset…' }
    ));

  // camera toggle peserta
  const btnPesertaRotate = $('#btn-cam-rotate');
  if (btnPesertaRotate){
    btnPesertaRotate.addEventListener('click', ()=> toggleCamera('peserta'));
  }

}

/* =========================
   Camera Modals (fullscreen)
   ========================= */
function initCameraModals(){
  const pModal = $('#pcam-modal');
  const aModal = $('#acam-modal');

  const openP = $('#btn-open-pcam');
  const closeP = $('#btn-close-pcam');

  const openA = $('#btn-open-acam');
  const closeA = $('#btn-close-acam');

  // open-close camera modal
    if (openP){
    openP.addEventListener('click', async()=>{
      await openPesertaCameraModal();
      if (($('#mode')?.value || '') === 'gate' && !State.gateDirection){
        UI.setResult('Mode Mobilitas Peserta: pilih dulu Masuk atau Keluar agar tombol Presensi aktif.', false);
      }
    });
  }

  if (closeP){
    closeP.addEventListener('click', ()=> closePesertaCameraModal());
  }


  // klik backdrop untuk tutup (peserta)
    if (pModal){
    pModal.addEventListener('click', (e)=>{
      if (e.target === pModal) closePesertaCameraModal();
    });
  }

  // open admin enroll camera modal
  if (openA){
    openA.addEventListener('click', async()=>{
      show(aModal);
      // ✅ start kamera dulu (permission kamera di sini)
    try{ await switchCamera('admin', State.cam.adminFacing); }
    catch(e){
      UI.setAdminResult(String(e?.message || e), false);
      return;
    }
    // ✅ Baru fullscreen
        try{ await aModal.requestFullscreen?.(); } catch(e){}
    });
  }

  // close admin enroll camera modal
  if (closeA){
    closeA.addEventListener('click', ()=>{
      hide(aModal);
      try{ document.fullscreenElement && document.exitFullscreen?.(); } catch(e){}
      try{ stopStream($('#a_video')); } catch(e){}
    });
  }

  // klik backdrop untuk tutup (admin)
  if (aModal){
    aModal.addEventListener('click', (e)=>{
      if (e.target === aModal) closeA?.click();
    });
  }

  // ESC untuk tutup
    document.addEventListener('keydown', (e)=>{
    if (e.key !== 'Escape') return;
    if (pModal && !pModal.classList.contains('hidden')) closePesertaCameraModal();
    if (aModal && !aModal.classList.contains('hidden')) closeA?.click();
  });
}

/* =========================
   Helper: open/close peserta camera modal
   (dipakai oleh tombol "Buka Kamera" & Mobilitas IN/OUT)
   ========================= */
async function openPesertaCameraModal(){
  const pModal = $('#pcam-modal');
  if (!pModal) return;

  show(pModal);

  // title dinamis
  const mode = ($('#mode')?.value || 'training');
  const titleEl = $('#pcam-title');
  if (titleEl){
    if (mode === 'training'){
      titleEl.textContent = 'Kamera Presensi - Kegiatan Training';
    } else {
      const dir = (State.gateDirection === 'IN') ? 'MASUK' : (State.gateDirection === 'OUT' ? 'KELUAR' : '');
      titleEl.textContent = dir
        ? `Kamera Presensi - Mobilitas Peserta (${dir})`
        : 'Kamera Presensi - Mobilitas Peserta';
    }
  }
  
  // ✅ 1) izin lokasi
  try{
    // hanya cek jika belum pernah valid atau sebelumnya error
    if (State.locError || !isFinite(State.loc.distance_m)){
      await checkLocation({ force:false, silent:false, maxAgeMs:45000 });
    }
  }catch(e){
    UI.setResult('Aktifkan izin lokasi agar Presensi bisa digunakan.', false);
  }

  // ✅ 2) Start / restore camera stream dulu
  try{
    await switchCamera('peserta', State.cam.pesertaFacing);
  } catch(e){
    // kalau kamera gagal, jangan fullscreen
    UI.setResult(String(e?.message || e), false);
    updateScanBadge();
    validateEnablePresensi();
    return;
  }

  // ✅ 3) Request fullscreen (setelah permission request selesai)
  try{
    await pModal.requestFullscreen?.();
  } catch(e){}

  updateScanBadge();
  validateEnablePresensi();
}

function closePesertaCameraModal(){
  const pModal = $('#pcam-modal');
  if (!pModal) return;

  hide(pModal);
  try{ document.fullscreenElement && document.exitFullscreen?.(); } catch(e){}
  try{ stopStream($('#video')); } catch(e){}

  // ✅ kalau sedang Mobilitas dan user menutup kamera, reset arah agar tidak “nyangkut”
  if (($('#mode')?.value || '') === 'gate'){
    State.gateDirection = null;
  }
  updateScanBadge();
  validateEnablePresensi();
}

/* =========================================================
   ✅ DASHBOARD ADMIN (Daftar Hadir + Mobilitas) + EXPORT XLSX/PDF
   Backend actions:
   - adminPesertaMeta
   - adminTrainingReport
   - adminGateReport
   - adminExportXlsx
   - adminExportPdf
   ========================================================= */

function b64ToBlob(b64, mime){
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1200);
}

async function adminPesertaMeta(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminPesertaMeta', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal ambil meta peserta');
  return r;
}

/* =========================================================
   ✅ DASHBOARD FILTER CASCADING (TrainingType -> Group -> Activity -> Material)
   ========================================================= */

function isNeedMaterialByActivity_(act){
  const a = String(act||'').trim().toLowerCase();
  return (a === 'sesi kelas' || a === 'field day');
}

function fillSelectKeep(el, items, placeholder){
  // wrapper agar aman kalau null
  fillSelect(el, items || [], placeholder || 'Pilih…');
}

function dashBindCascadingFilters(meta){
  // simpan meta dashboard agar bisa dipakai ulang
  State._dashMeta = meta || {};

  const ttEl = $('#d_training_type');
  const grpEl = $('#d_group');
  const actEl = $('#d_activity');
  const matEl = $('#d_material');

  if (!ttEl || !grpEl || !actEl || !matEl) return;

  // 1) isi TRAINING TYPE
  const trainingTypes = (meta.jenis_pelatihan || meta.training_types || []);
  fillSelectKeep(ttEl, trainingTypes, 'Pilih Training Type…');

  // 2) fungsi refresh berjenjang
  const refreshCascade = ()=>{
    const tt = (ttEl.value || '').trim();
    const groupsByType = meta.groups_by_training_type || {};
    const actsByType   = meta.activities_by_training_type || {};
    const matsByTypeAct= meta.materials_by_type_activity || {};
    const matsAll      = meta.materials_all || [];

    // GROUP tergantung TRAINING TYPE
    const groups = tt ? (groupsByType[tt] || []) : (meta.groups || []);
    fillSelectKeep(grpEl, groups, 'Pilih Batch');

    // ACTIVITY tergantung TRAINING TYPE
    const acts = tt ? (actsByType[tt] || []) : [];
    fillSelectKeep(actEl, acts, 'Pilih Activity…');

    // MATERI tergantung ACTIVITY (boleh kosong)
    const act = (actEl.value || '').trim();

    if (!isNeedMaterialByActivity_(act)){
      // activity bukan sesi kelas/field day => materi boleh kosong & dropdown tetap ada
      fillSelectKeep(matEl, [], '(Materi opsional)');
      matEl.value = '';
      return;
    }

    // activity butuh materi => tampilkan opsi, tapi tetap boleh kosong (user boleh pilih blank)
    const matsUsed = (tt && act && matsByTypeAct[tt] && matsByTypeAct[tt][act]) ? matsByTypeAct[tt][act] : [];
    const mats = (matsUsed && matsUsed.length) ? matsUsed : matsAll; // fallback ke master list
    fillSelectKeep(matEl, mats, '(Boleh kosong / semua materi)');
  };

  // 3) event chain
  ttEl.addEventListener('change', ()=>{
    refreshCascade();
  });

  grpEl.addEventListener('change', ()=>{
    // group tidak memengaruhi activity/materi sesuai requirement Anda,
    // tapi tetap validasi bisa jalan kalau Anda mau tambah aturan nanti
  });

  actEl.addEventListener('change', ()=>{
    refreshCascade();
  });

  // 4) initial refresh
  refreshCascade();
}

function fillSelect(el, items, placeholder='Pilih…'){
  if (!el) return;
  const cur = el.value || '';
  el.innerHTML = `<option value="">${placeholder}</option>` + (items||[])
    .map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  if (cur && (items||[]).includes(cur)) el.value = cur;
}

async function initDashboardMeta(){
  try{
    const meta = await adminPesertaMeta();

    // ✅ dashboard TRAINING: cascading
    dashBindCascadingFilters(meta);

    // ✅ dashboard GATE tetap pakai group global (opsional)
    fillSelect($('#g_group'), meta.groups || [], '(opsional)');

  } catch(e){
    UI.setAdminResult(String(e.message || e), false);
  }
}

function dashTodayDefaults(){
  const t = todayISO();
  if ($('#d_date')) $('#d_date').value = t;
  if ($('#g_start')) $('#g_start').value = t;
  if ($('#g_end')) $('#g_end').value = t;
}

function renderDaftarHadir(rows){
  const tb = $('#d_table tbody');
  tb.innerHTML = (rows||[]).map((r, i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(r.nik)}</td>
      <td>${escapeHtml(r.nama)}</td>
      <td>${escapeHtml(r.estate || '')}</td>
      <td>${escapeHtml(r.region || '')}</td>
      <td>${escapeHtml(r.timestamp || '')}</td>
    </tr>
  `).join('');
}

function renderGateTable(view, rows){
  const thead = $('#g_table thead');
  const tbody = $('#g_table tbody');

  if (view === 'person'){
    thead.innerHTML = `
      <tr>
        <th>Tanggal</th><th>NIK</th><th>Nama</th><th>Reason</th>
        <th>IN Times</th><th>OUT Times</th><th>Total</th>
      </tr>`;
    tbody.innerHTML = (rows||[]).map(r=>`
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.nik)}</td>
        <td>${escapeHtml(r.nama)}</td>
        <td>${escapeHtml(r.gate_reason || '')}</td>
        <td>${escapeHtml(r.in_times || '')}</td>
        <td>${escapeHtml(r.out_times || '')}</td>
        <td>${escapeHtml(String(r.total || 0))}</td>
      </tr>
    `).join('');
  } else {
    thead.innerHTML = `
      <tr>
        <th>Tanggal</th><th>Reason</th><th>IN</th><th>OUT</th><th>Total</th>
      </tr>`;
    tbody.innerHTML = (rows||[]).map(r=>`
      <tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.gate_reason || '')}</td>
        <td>${escapeHtml(String(r.in_count || 0))}</td>
        <td>${escapeHtml(String(r.out_count || 0))}</td>
        <td>${escapeHtml(String(r.total || 0))}</td>
      </tr>
    `).join('');
  }
}

async function adminPreviewTraining(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const date = ($('#d_date').value || '').trim();
  const group = ($('#d_group').value || '').trim();
  const training_type = ($('#d_training_type').value || '').trim();
  const activity = ($('#d_activity').value || '').trim();
  const material = ($('#d_material').value || '').trim();
  const location = ($('#d_location').value || 'Seriang Training Center').trim();

  if (!date || !group || !training_type || !activity){
    throw new Error('Wajib isi: Tanggal, Batch/Group, Training Type, Activity.');
  }

  const r = await api('adminTrainingReport', {
    admin_token: State.adminToken,
    date, group, training_type, activity, material, location
  });

  if (!r.ok) throw new Error(r.error || 'Gagal membuat report daftar hadir');

  $('#d_summary').textContent =
    `Total roster: ${r.stats?.total || 0} | Hadir: ${r.stats?.hadir || 0} | Tidak Hadir: ${r.stats?.absen || 0}`;

  renderDaftarHadir(r.rows || []);
}

async function adminPreviewGate(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const start = ($('#g_start').value || '').trim();
  const end = ($('#g_end').value || '').trim();
  const view = ($('#g_view').value || 'daily').trim();
  const gate_reason = ($('#g_reason').value || '').trim();
  const nik = ($('#g_nik').value || '').trim();
  const group = ($('#g_group').value || '').trim();

  if (!start || !end) throw new Error('Tanggal Mulai & Akhir wajib diisi.');

  if (view === 'person' && !nik){
    throw new Error('Mode "Per Peserta" membutuhkan NIK.');
  }

  const r = await api('adminGateReport', {
    admin_token: State.adminToken,
    start, end, view, gate_reason, nik, group
  });

  if (!r.ok) throw new Error(r.error || 'Gagal membuat report mobilitas');

  $('#g_summary').textContent = r.summary_text || `Rows: ${(r.rows||[]).length}`;
  renderGateTable(view, r.rows || []);
}

async function adminExportDashboard(fmt, reportType){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  let payload = { admin_token: State.adminToken, report_type: reportType };

  if (reportType === 'training'){
    payload.date = ($('#d_date').value || '').trim();
    payload.group = ($('#d_group').value || '').trim();
    payload.training_type = ($('#d_training_type').value || '').trim();
    payload.activity = ($('#d_activity').value || '').trim();
    payload.material = ($('#d_material').value || '').trim();
    payload.location = ($('#d_location').value || 'Seriang Training Center').trim();
  } else {
    payload.start = ($('#g_start').value || '').trim();
    payload.end = ($('#g_end').value || '').trim();
    payload.view = ($('#g_view').value || 'daily').trim();
    payload.gate_reason = ($('#g_reason').value || '').trim();
    payload.nik = ($('#g_nik').value || '').trim();
    payload.group = ($('#g_group').value || '').trim();
  }

  const action = (fmt === 'pdf') ? 'adminExportPdf' : 'adminExportXlsx';
  const r = await api(action, payload);
  if (!r.ok) throw new Error(r.error || 'Export gagal');

  const blob = b64ToBlob(r.b64, r.mime);
  downloadBlob(blob, r.filename || (reportType + (fmt==='pdf'?'.pdf':'.xlsx')));
}

/* hook untuk toggle input Per Peserta */
function bindGateViewToggle(){
  const sel = $('#g_view');
  const wrap = $('#g_person_wrap');
  if (!sel || !wrap) return;

  const refresh = ()=>{
    wrap.style.display = (sel.value === 'person') ? 'grid' : 'none';
  };
  sel.addEventListener('change', refresh);
  refresh();
}

async function main(){
  UI.setStatus('⏳ Aplikasi sedang disiapkan…');
  
  State.deviceId = getOrCreateDeviceId();
  $('#device-info').innerHTML = `Device ID: <b>${escapeHtml(State.deviceId)}</b>`;

  initMode();
  initTraining();
  initAdminModal();
  initCameraModals();

    $('#btn-checkloc').addEventListener('click', ()=> Busy.wrap(
    $('#btn-checkloc'),
    async()=>{
      try{
        await checkLocation({ force:true, silent:false });

        // ✅ jangan hardcode "berhasil", tampilkan sesuai inFence
        updatePresensiReadyMessage();

      } catch(e){
        UI.setResult(e.message || String(e), false);
      }
    },
    { text:'Cek Lokasi…' }
  ));

$('#btn-presensi').addEventListener('click', ()=> Busy.wrap(
  $('#btn-presensi'),
  async()=> await doPresensi(),
  { text:'Memproses…' } // tombol spinner saja (tanpa overlay) agar video tetap terlihat
));

  // camera peserta + admin
  // load config dulu (agar liveness/threshold/geofence siap)
  await loadConfig(true);
    // ✅ AUTO cek lokasi saat aplikasi load/refresh
  updateLocPill(); // tampilkan status awal "Sedang cek lokasi…"
  try{
    await checkLocation({ force:false, silent:true, maxAgeMs:45000 });
    try{
        await checkLocation({ force:false, silent:true, maxAgeMs:45000 });
      } catch(e){}

      // ✅ satu pintu status: sesuai kondisi lokasi + kelengkapan input
      updatePresensiReadyMessage();
  } catch(e){
    // silent:true biasanya tidak throw, tapi jaga-jaga
  }

  // Kamera sekarang dibuka saat modal dibuka (lebih hemat & full screen)
  // await switchCamera('peserta', State.cam.pesertaFacing);
  // await switchCamera('admin', State.cam.adminFacing);
  updateLocPill();
  validateEnablePresensi();

  // warm up models
  try{ await loadModels(); } catch(e){ /* will retry on demand */ }
}

main();
