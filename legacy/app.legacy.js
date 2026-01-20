// SECTION: Legacy Monolith (Backup)
// Purpose : Original single-file app.js before modularization.
// Notes   : Not loaded by index.html; kept only as reference/backup.

const $ = (s, r=document) => r.querySelector(s);

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
  ui: {
    pcamOpen: false
  },

  adminToken: localStorage.getItem('admin_token') || '',
  adminExp: Number(localStorage.getItem('admin_exp') || 0),
  cam: {
    pesertaFacing: localStorage.getItem('cam_peserta') || 'user',   // 'user' | 'environment'
    adminFacing:   localStorage.getItem('cam_admin')   || 'user',
    streams: { peserta:null, admin:null }
  }
};

const UI = {
    _resultEl(){
    const inCam = !!State?.ui?.pcamOpen;

    // fallback kalau flag belum sempat ter-set
    if (!inCam){
      const pModal = document.getElementById('pcam-modal');
      const isVisible = pModal && !pModal.classList.contains('hidden') && pModal.getAttribute('aria-hidden') !== 'true';
      if (isVisible) return document.getElementById('result-cam');
    }

    return document.getElementById(inCam ? 'result-cam' : 'result-main');
  },

  setStatus(text){
    const el = this._resultEl();
    if (!el) return;
    el.innerHTML = `<div class="small">${text}</div>`;
  },

    setResult(msg, ok=true){
    const html =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'BERHASIL':'GAGAL'}</div><div class="small">${msg}</div>`;

    const main = document.getElementById('result-main');
    if (main) main.innerHTML = html;

    const cam  = document.getElementById('result-cam');
    if (cam && State?.ui?.pcamOpen) cam.innerHTML = html;
  },

  setAdminResult(msg, ok=true){
    const el = document.getElementById('admin-result');
    if (!el) return;
    el.innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'OK':'ERROR'}</div><div class="small">${msg}</div>`;
  }
};

/* =========================================================
   ✅ CAMERA RESULT OVERLAY (BIG ✅/❌) + HOLD/LOCK STATUS
   - tampil di modal kamera peserta
   - BERHASIL: auto-close modal setelah jeda
   - GAGAL: tampil beberapa detik, lalu hilang (tetap di modal)
   ========================================================= */

State.ui = State.ui || {};
State.ui.outcomeLock = false;
State.ui.outcomeTimer = null;
State.ui.lastPresensiFailed = false;
State.ui.lastFailMessage = '';

function camOutcomeEnsureUI(){
  // ✅ overlay dibuat sebagai "portal" ke body agar tidak kalah z-index / stacking context video
  let ov = document.getElementById('cam-outcome');
  if (!ov){
    // inject style sekali
    if (!document.getElementById('cam-outcome-style')){
      const st = document.createElement('style');
      st.id = 'cam-outcome-style';
      st.textContent = `
        .cam-outcome{
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          z-index: 2147483647; /* super top */
          background: rgba(0,0,0,.45);
          backdrop-filter: blur(2px);
          pointer-events: auto;

          /* ✅ safe-area padding (iOS notch) */
          padding-top: env(safe-area-inset-top);
          padding-bottom: env(safe-area-inset-bottom);
          padding-left: env(safe-area-inset-left);
          padding-right: env(safe-area-inset-right);
        }
        .cam-outcome.on{ display:flex; }

        .cam-outcome .box{
          width: min(520px, 92vw);
          border-radius: 22px;
          padding: 18px 18px 16px;
          text-align: center;
          color: #fff;
          box-shadow: 0 24px 80px rgba(0,0,0,.55);
          border: 1px solid rgba(255,255,255,.14);

          /* ✅ agar tidak kepotong di layar kecil / landscape */
          max-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px);
          overflow: auto;
          -webkit-overflow-scrolling: touch;
        }

        /* ✅ ukuran adaptif (mobile -> desktop) */
        .cam-outcome .icon{
          font-size: clamp(78px, 18vw, 120px);
          line-height: 1;
          margin: 10px 0 10px;
          filter: drop-shadow(0 12px 28px rgba(0,0,0,.55));
        }
        .cam-outcome .title{
          font-weight: 1000;
          letter-spacing: .08em;
          font-size: clamp(22px, 6.5vw, 34px);
          margin: 0 0 8px;
        }
        .cam-outcome .desc{
          font-size: clamp(13px, 3.5vw, 14px);
          opacity: .92;
          line-height: 1.35;
        }

        .cam-outcome.ok .box{
          background:
            radial-gradient(circle at 30% 20%, rgba(34,197,94,.35), transparent 45%),
            radial-gradient(circle at 70% 15%, rgba(16,185,129,.25), transparent 40%),
            rgba(6,95,70,.78);
        }
        .cam-outcome.fail .box{
          background:
            radial-gradient(circle at 30% 20%, rgba(239,68,68,.38), transparent 45%),
            radial-gradient(circle at 70% 15%, rgba(244,63,94,.25), transparent 40%),
            rgba(127,29,29,.78);
        }

        /* ✅ ekstra kecil: rapikan padding */
        @media (max-width: 420px){
          .cam-outcome .box{
            width: min(520px, 94vw);
            padding: 14px 14px 12px;
            border-radius: 18px;
          }
          .cam-outcome .title{
            letter-spacing: .06em;
          }
        }

        /* ✅ landscape pendek: kecilkan margin supaya muat */
        @media (orientation: landscape) and (max-height: 420px){
          .cam-outcome .icon{ margin: 6px 0 6px; }
          .cam-outcome .title{ margin-bottom: 6px; }
        }
      `;
      document.head.appendChild(st);
    }

    ov = document.createElement('div');
    ov.id = 'cam-outcome';
    ov.className = 'cam-outcome';
    ov.innerHTML = `
      <div class="box" role="status" aria-live="polite">
        <div class="icon" id="cam-outcome-icon">✅</div>
        <div class="title" id="cam-outcome-title">BERHASIL</div>
        <div class="desc"  id="cam-outcome-desc"></div>
      </div>
    `;
    document.body.appendChild(ov);

    // klik overlay untuk menutup overlay (opsional)
    ov.addEventListener('click', ()=>{
      camOutcomeHide();
    });
  }

  return ov;
}

function camOutcomeShow(ok, descHtml, opts = {}){
  const ov = camOutcomeEnsureUI();
  if (!ov) return;

  // kunci smart status & hasil
  State.ui.outcomeLock = true;
  statusSetLock(true); // ✅ cegah smartStatus menimpa hasil

  // cancel timer lama
  if (State.ui.outcomeTimer) clearTimeout(State.ui.outcomeTimer);
  State.ui.outcomeTimer = null;

  ov.classList.remove('ok','fail');
  ov.classList.add(ok ? 'ok' : 'fail');
  ov.classList.add('on');

  const icon = document.getElementById('cam-outcome-icon');
  const title= document.getElementById('cam-outcome-title');
  const desc = document.getElementById('cam-outcome-desc');

  if (icon)  icon.textContent  = ok ? '✅' : '❌';
  if (title) title.textContent = ok ? 'BERHASIL' : 'GAGAL';
  if (desc)  desc.innerHTML    = String(descHtml || '');

  // auto behavior
  const closeOnOk = (opts.closeOnOk !== false);   // default true
  const delayOkMs = Number(opts.delayOkMs ?? 1600);
  const delayFailMs = Number(opts.delayFailMs ?? 2200);

  State.ui.outcomeTimer = setTimeout(()=>{
    if (ok && closeOnOk){
      // auto close modal
      try{ closePesertaCameraModal(); }catch(e){}
    }
    camOutcomeHide(); // kalau ok: setelah close, overlay hilang; kalau fail: hilang saja
  }, ok ? delayOkMs : delayFailMs);
}

function camOutcomeHide(){
  const ov = document.getElementById('cam-outcome');
  if (ov) ov.classList.remove('on');

  if (State.ui.outcomeTimer) clearTimeout(State.ui.outcomeTimer);
  State.ui.outcomeTimer = null;

  // buka lock kembali (biar smart status bisa update lagi)
  State.ui.outcomeLock = false;
  statusSetLock(false);
}


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
    .detectSingleFace( videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
    )
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
async function captureMultiShotAvg(videoEl, shots=3, maxMs=2500){
  if (!State.modelsReady) await loadModels();

  const got = [];
  const t0 = performance.now();

  while (got.length < shots && (performance.now() - t0) < maxMs){
    const det = await detectOnce(videoEl);
    if (det && det.descriptor){
      got.push(Array.from(det.descriptor));
      // tunggu 1-2 frame saja biar descriptor beda (lebih cepat dari sleep 220ms)
      await nextFrame(); 
      await nextFrame();
    } else {
      // kalau belum dapat wajah, cukup tunggu 1 frame
      await nextFrame();
    }
  }

  if (got.length < shots) return null;
  return avgDescriptors(got);
}

function nextFrame(){
  return new Promise(r => requestAnimationFrame(()=>r()));
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

    await nextFrame();
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
  ? `Di area (${Math.round(L.distance_m)} m) • ${L.fence_name || 'Lokasi'}`
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

/* =========================================================
   ✅ MULTI GEOFENCE (Frontend Controlled)
   - Simpan titik di localStorage (CRUD + aktif/nonaktif)
   - checkLocation() akan pakai titik aktif (nearest)
   - fallback ke config server (single geofence) jika list kosong
   ========================================================= */

const GEOF = {
  LS_KEY: 'geofence_points_v1',
  // point: { id, name, lat, lng, radius_m, active }
  points: []
};

function gfUid(){
  return 'gf_' + Math.random().toString(16).slice(2) + '_' + Date.now();
}

function gfLoadFromLS(){
  try{
    const raw = localStorage.getItem(GEOF.LS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    const pts = Array.isArray(obj?.points) ? obj.points : [];
    GEOF.points = pts.map(p=>({
      id: String(p.id || gfUid()),
      name: String(p.name || 'Titik'),
      lat: Number(p.lat),
      lng: Number(p.lng),
      radius_m: Number(p.radius_m || 50),
      active: (String(p.active ?? 'TRUE').toUpperCase() !== 'FALSE')
    })).filter(p => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radius_m));
  }catch(e){
    GEOF.points = [];
  }
}

function gfSaveToLS(){
  try{
    localStorage.setItem(GEOF.LS_KEY, JSON.stringify({
      points: GEOF.points,
      savedAt: Date.now()
    }));
  }catch(e){}
}

function gfActivePoints(){
  return (GEOF.points || []).filter(p => !!p.active);
}

/* =========================================================
   ✅ ADMIN TAB: MULTI LOKASI (GEOFENCE) - PANE SENDIRI
   - tanpa edit index.html (dibuat via JS)
   ========================================================= */

function gfEnsureAdminTabPane(){
  // 1) pastikan tombol tab ada
  const tabs = document.querySelector('#admin-pane .tabs2');
  if (tabs && !tabs.querySelector('.tab2[data-atab="geofence"]')){
    const btn = document.createElement('button');
    btn.className = 'tab2';
    btn.type = 'button';
    btn.dataset.atab = 'geofence';
    btn.textContent = 'Multi Lokasi';
    tabs.appendChild(btn);
  }

  // 2) pastikan pane ada
  const adminPane = document.getElementById('admin-pane');
  if (adminPane && !document.getElementById('apane-geofence')){
    const p = document.createElement('div');
    p.className = 'apane hidden';      // ikut pola tab Anda
    p.id = 'apane-geofence';
    p.innerHTML = `
      <div id="gf-pane-host"></div>
      <div class="small" style="opacity:.75;margin-top:10px;">
        *List lokasi otomatis diambil dari server saat tab ini dibuka.
      </div>
    `;
    adminPane.appendChild(p);
  }
}

/* =========================================================
   ✅ GEOFENCE SERVER SYNC (Google Sheet)
   Requires backend actions:
   - adminGeofenceList
   - adminGeofenceUpsert
   - adminGeofenceDelete
   ========================================================= */

function gfNormPoint(p){
  return {
    id: String(p?.id || gfUid()),
    name: String(p?.name || 'Titik').trim() || 'Titik',
    lat: Number(p?.lat),
    lng: Number(p?.lng),
    radius_m: Number(p?.radius_m || 50),
    active: (String(p?.active ?? 'TRUE').toUpperCase() !== 'FALSE'),
    sort: Number(p?.sort || 0)
  };
}

function gfGetServerPointsActive(){
  const pts = (State?.cfg && Array.isArray(State.cfg.geofence_points)) ? State.cfg.geofence_points : [];
  // backend mengirim: {id,name,lat,lng,radius_m,active,sort,...}
  return (pts || [])
    .map(gfNormPoint)
    .filter(p => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radius_m) && p.radius_m > 0)
    .filter(p => !!p.active);
}

/* ✅ MODIF: gunakan local aktif -> kalau kosong gunakan server points -> kalau kosong fallback single */
function gfGetCentersFromCfgOrLocal(){
  const actLocal = gfActivePoints();
  if (actLocal.length) return actLocal;

  const actServer = gfGetServerPointsActive();
  if (actServer.length) return actServer;

  // fallback ke server single geofence (kompatibel versi lama)
  const c = State?.cfg?.geofence?.center;
  const r = Number(State?.cfg?.geofence?.radius_m);
  if (c && isFinite(c.lat) && isFinite(c.lng) && isFinite(r) && r > 0){
    return [{
      id: 'server_default',
      name: 'Default (Server)',
      lat: Number(c.lat),
      lng: Number(c.lng),
      radius_m: r,
      active: true
    }];
  }
  return [];
}

async function gfServerList(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminGeofenceList', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal load geofence dari server');
  return (r.items || []).map(gfNormPoint);
}

async function gfServerUpsert(point){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const p = gfNormPoint(point);

  const r = await api('adminGeofenceUpsert', {
    admin_token: State.adminToken,
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    radius_m: p.radius_m,
    active: p.active,
    sort: p.sort
  });

  if (!r.ok) throw new Error(r.error || 'Gagal simpan titik geofence (server)');
  return r;
}

async function gfServerDelete(id){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminGeofenceDelete', { admin_token: State.adminToken, id: String(id||'') });
  if (!r.ok) throw new Error(r.error || 'Gagal hapus titik geofence (server)');
  return r;
}

/* ✅ Pull server -> localStorage (agar device konsisten) */
async function gfPullFromServerToLocal(){
  const pts = await gfServerList();
  GEOF.points = pts;
  gfSaveToLS();
  // refresh config juga (supaya State.cfg.geofence_points ikut update di device ini)
  try{ await loadConfig(true); }catch(e){}
  gfRenderAdminTable();
}

/* ✅ Push semua local -> server (opsional kalau Anda sudah terlanjur input banyak lokal) */
async function gfPushAllLocalToServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const pts = (GEOF.points || []).map(gfNormPoint);

  for (const p of pts){
    await gfServerUpsert(p);
  }
  // setelah push, pull balik agar rapi + urut sesuai server
  await gfPullFromServerToLocal();
}

/**
 * gfComputeNearest(lat,lng)
 * return: { ok, best, distance_m, inFence, checkedCount }
 */
function gfComputeNearest(lat, lng){
  const centers = gfGetCentersFromCfgOrLocal();
  if (!centers.length){
    return { ok:false, best:null, distance_m:NaN, inFence:false, checkedCount:0 };
  }

  let best = null;
  let bestD = Infinity;

  for (const p of centers){
    const d = haversineM(p.lat, p.lng, lat, lng);
    if (d < bestD){
      bestD = d;
      best = p;
    }
  }

  const inFence = best ? (bestD <= Number(best.radius_m || 0)) : false;
  return { ok:true, best, distance_m: bestD, inFence, checkedCount: centers.length };
}

/* =========================
   UI Admin: Manage Geofence Points
   - Dibuat dinamis (tanpa edit HTML)
   - Muncul di dalam #admin-pane (paling bawah)
   ========================= */

function gfEnsureAdminUI(){
  // ✅ pastikan pane geofence sudah ada
  gfEnsureAdminTabPane();

  // ✅ tempel UI ke pane khusus (bukan ke bawah enroll)
  const host =
    document.getElementById('gf-pane-host') ||
    document.getElementById('apane-geofence') ||
    document.getElementById('admin-pane');

  if (!host) return null;

  let box = document.getElementById('gf-admin');
  if (box) return box;


  // inject minimal style
  if (!document.getElementById('gf-admin-style')){
    const st = document.createElement('style');
    st.id = 'gf-admin-style';
    st.textContent = `
      #gf-admin{ margin-top:16px; padding:14px; border:1px solid rgba(0,0,0,.12); border-radius:14px; background:rgba(255,255,255,.04); }
      #gf-admin h3{ margin:0 0 10px; font-weight:900; }
      #gf-admin .row{ display:grid; grid-template-columns: 1.3fr .9fr .9fr .8fr .7fr; gap:8px; align-items:center; }
      #gf-admin .row > *{ min-width:0; }
      #gf-admin input, #gf-admin select{
          width:100%;
          padding:8px 10px;
          border-radius:10px;
          border:1px solid rgba(0,0,0,.22);
          background:#fff;
          color:#000;
        }
        #gf-admin input::placeholder{ color: rgba(0,0,0,.55); }
      #gf-admin .mini{ font-size:12px; opacity:.85; }
      #gf-admin table{ width:100%; border-collapse:collapse; margin-top:10px; }
      #gf-admin th, #gf-admin td{ padding:8px; border-bottom:1px solid rgba(0,0,0,.08); text-align:left; font-size:13px; }
      #gf-admin .btns{ display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
      #gf-admin .tag{ display:inline-block; padding:2px 8px; border-radius:999px; font-weight:800; font-size:12px; }
      #gf-admin .tag.ok{ background:rgba(34,197,94,.15); color:#166534; }
      #gf-admin .tag.off{ background:rgba(239,68,68,.12); color:#7f1d1d; }
      @media (max-width: 720px){
        #gf-admin .row{ grid-template-columns: 1fr 1fr; }
      }
    `;
    document.head.appendChild(st);
  }

  box = document.createElement('div');
  box.id = 'gf-admin';
  box.innerHTML = `
    <h3>📍 Multi Lokasi Geofence</h3>
    <div class="mini">
      Anda bisa tambah/kurangi titik (lat,lng,radius) dari frontend.
      checkLocation() akan memakai titik <b>aktif</b> terdekat. Jika kosong, fallback ke Default (Server).
    </div>

    <div style="margin-top:10px;" class="row">
      <input id="gf_name" placeholder="Nama titik (contoh: Training Center A)" />
      <input id="gf_lat"  placeholder="Lat (contoh: -1.23456)" inputmode="decimal"/>
      <input id="gf_lng"  placeholder="Lng (contoh: 112.34567)" inputmode="decimal"/>
      <input id="gf_rad"  placeholder="Radius (m)" inputmode="numeric"/>
      <select id="gf_active">
        <option value="TRUE" selected>Aktif</option>
        <option value="FALSE">Nonaktif</option>
      </select>
    </div>

    <div class="btns">
      <button class="btn primary" type="button" id="gf_add">Tambah Titik</button>
      <button class="btn" type="button" id="gf_use_current">Gunakan Lokasi Saat Ini</button>
      <button class="btn" type="button" id="gf_clear">Hapus Semua (Local)</button>
      <button class="btn" type="button" id="gf_refresh">Refresh List</button>
    </div>

    <div id="gf_info" class="mini" style="margin-top:8px;">-</div>

    <table>
      <thead>
        <tr>
          <th>Nama</th><th>Lat</th><th>Lng</th><th>Radius</th><th>Status</th><th>Aksi</th>
        </tr>
      </thead>
      <tbody id="gf_tbody"></tbody>
    </table>
  `;

  host.appendChild(box);
  return box;
}

function gfRenderAdminTable(){
  const tb = document.getElementById('gf_tbody');
  const info = document.getElementById('gf_info');
  if (!tb || !info) return;

  const act = gfActivePoints().length;
  info.innerHTML = `Titik tersimpan (local): <b>${GEOF.points.length}</b> • Aktif: <b>${act}</b>`;

  if (!GEOF.points.length){
    tb.innerHTML = `<tr><td colspan="6" class="mini">Belum ada titik. (Saat ini masih pakai Default Server)</td></tr>`;
    return;
  }

  tb.innerHTML = GEOF.points.map(p=>`
    <tr>
      <td><b>${escapeHtml(p.name)}</b><div class="mini">${escapeHtml(p.id)}</div></td>
      <td>${escapeHtml(String(p.lat))}</td>
      <td>${escapeHtml(String(p.lng))}</td>
      <td>${escapeHtml(String(p.radius_m))} m</td>
      <td>${p.active ? `<span class="tag ok">AKTIF</span>` : `<span class="tag off">OFF</span>`}</td>
      <td>
        <button class="btn" type="button" data-gf-toggle="${escapeHtml(p.id)}">${p.active?'Nonaktifkan':'Aktifkan'}</button>
        <button class="btn danger" type="button" data-gf-del="${escapeHtml(p.id)}">Hapus</button>
      </td>
    </tr>
  `).join('');

  // bind actions
  tb.querySelectorAll('[data-gf-toggle]').forEach(b=>{
    b.addEventListener('click', async()=>{
      try{
        if (!isAdminSessionValid()){
          UI.setAdminResult('Sesi admin habis. Login ulang.', false);
          return;
        }

        const id = b.getAttribute('data-gf-toggle');
        const it = GEOF.points.find(x => x.id === id);
        if (!it) return;

        it.active = !it.active;

        // ✅ upsert ke server
        await gfServerUpsert(it);

        // ✅ pull ulang biar konsisten
        await gfPullFromServerToLocal();

        UI.setAdminResult(`✅ Status diubah: ${it.name} = ${it.active ? 'AKTIF' : 'OFF'}`, true);
        try{ smartStatusUpdate(true); }catch(e){}
      }catch(e){
        if (handleAdminAuthError_(e)) return;
        UI.setAdminResult(String(e.message || e), false);
      }
    });
  });

  tb.querySelectorAll('[data-gf-del]').forEach(b=>{
    b.addEventListener('click', async()=>{
      try{
        if (!isAdminSessionValid()){
          UI.setAdminResult('Sesi admin habis. Login ulang.', false);
          return;
        }

        const id = b.getAttribute('data-gf-del');
        const it = GEOF.points.find(x => x.id === id);
        if (!it) return;

        if (!confirm(`Hapus titik "${it.name}"? (akan terhapus di server)`)) return;

        // ✅ hapus di server
        await gfServerDelete(id);

        // ✅ pull ulang dari server
        await gfPullFromServerToLocal();

        UI.setAdminResult(`✅ Terhapus di server: ${it.name}`, true);
        try{ smartStatusUpdate(true); }catch(e){}
      }catch(e){
        if (handleAdminAuthError_(e)) return;
        UI.setAdminResult(String(e.message || e), false);
      }
    });
  });
    document.getElementById('gf_pull_server')?.addEventListener('click', ()=> Busy.wrap(
    document.getElementById('gf_pull_server'),
    async()=>{
      await gfPullFromServerToLocal();
      UI.setAdminResult('✅ Geofence ditarik dari server.', true);
    },
    { text:'Tarik…', overlay:true, overlayText:'Mengambil daftar geofence dari server…' }
  ));

  document.getElementById('gf_push_server')?.addEventListener('click', ()=> Busy.wrap(
    document.getElementById('gf_push_server'),
    async()=>{
      await gfPushAllLocalToServer();
      UI.setAdminResult('✅ Semua titik lokal dikirim ke server.', true);
    },
    { text:'Kirim…', overlay:true, overlayText:'Mengirim semua titik geofence ke server…' }
  ));
}

function gfBindAdminUIOnce(){
  if (State._gfUiBound) return;
  State._gfUiBound = true;

  gfEnsureAdminUI();
  gfRenderAdminTable();

    document.getElementById('gf_add')?.addEventListener('click', async()=>{
    try{
      if (!isAdminSessionValid()){
        UI.setAdminResult('Admin belum login / sesi habis. Login ulang.', false);
        return;
      }

      const name = (document.getElementById('gf_name')?.value || '').trim() || 'Titik';
      const lat  = Number(document.getElementById('gf_lat')?.value);
      const lng  = Number(document.getElementById('gf_lng')?.value);
      const rad  = Number(document.getElementById('gf_rad')?.value || 50);
      const active = (document.getElementById('gf_active')?.value || 'TRUE') === 'TRUE';

      if (!isFinite(lat) || !isFinite(lng) || !isFinite(rad) || rad <= 0){
        UI.setAdminResult('Lat/Lng/Radius tidak valid.', false);
        return;
      }

      // buat point (id stabil)
      const p = { id: gfUid(), name, lat, lng, radius_m: rad, active, sort: 0 };

      // ✅ simpan ke server
      await gfServerUpsert(p);

      // ✅ pull ulang dari server supaya semua rapi & konsisten
      await gfPullFromServerToLocal();

      UI.setAdminResult(`✅ Titik disimpan ke server: ${name}`, true);
      try{ smartStatusUpdate(true); }catch(e){}
    }catch(e){
      if (handleAdminAuthError_(e)) return;
      UI.setAdminResult(String(e.message || e), false);
    }
  });

  document.getElementById('gf_use_current')?.addEventListener('click', async()=>{
    try{
      // ambil GPS terbaru, tapi jangan mengganggu alur utama
      const pos = await getLocation({ maximumAge: 0 });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      const latEl = document.getElementById('gf_lat');
      const lngEl = document.getElementById('gf_lng');
      if (latEl) latEl.value = String(lat);
      if (lngEl) lngEl.value = String(lng);

      UI.setAdminResult('Lokasi saat ini disalin ke input Lat/Lng.', true);
    }catch(e){
      UI.setAdminResult(String(e.message || e), false);
    }
  });

  document.getElementById('gf_clear')?.addEventListener('click', ()=>{
    if (!confirm('Hapus semua titik geofence lokal? (akan kembali pakai Default Server)')) return;
    GEOF.points = [];
    gfSaveToLS();
    gfRenderAdminTable();
    UI.setAdminResult('Semua titik geofence lokal dihapus.', true);
    try{ smartStatusUpdate(true); }catch(e){}
  });

  document.getElementById('gf_refresh')?.addEventListener('click', ()=>{
    gfLoadFromLS();
    gfRenderAdminTable();
    UI.setAdminResult('List geofence lokal direfresh.', true);
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

    // ✅ MULTI GEOFENCE: cari titik aktif terdekat (fallback ke server default)
    const rr = gfComputeNearest(lat, lng);

    let d = rr.distance_m;
    let inFence = rr.inFence;

    // simpan info titik terpilih (optional, berguna untuk log/UI)
    State.loc = {
      lat, lng,
      accuracy_m: acc,
      distance_m: d,
      inFence,
      fence_id: rr.best?.id || '',
      fence_name: rr.best?.name || '',
      fence_radius_m: Number(rr.best?.radius_m || 0),
      fence_checked: Number(rr.checkedCount || 0)
    };

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
  }

  $('#btn-presensi').disabled = !ok;
  return ok; // ✅ penting: supaya bisa dipakai untuk pesan status
}

/* =========================================================
   ✅ SMART STATUS ENGINE (lebih responsif)
   - Auto update status saat user ubah pilihan
   - Tidak menimpa pesan "proses" (scan/liveness/presensi)
   ========================================================= */

// status lock: kalau sedang proses presensi/liveness, jangan override pesan
State.ui = State.ui || {};
State.ui.statusLock = false;
State.ui.lastCtxKey = '';
State.ui.lastStatusKey = '';

function statusSetLock(on){
  State.ui.statusLock = !!on;
}

function setPresensiFail(msg){
  State.ui.lastPresensiFailed = true;
  State.ui.lastFailMessage = String(msg || 'Presensi gagal.');
}

function clearPresensiFail(){
  State.ui.lastPresensiFailed = false;
  State.ui.lastFailMessage = '';
}

// Ambil konteks form saat ini untuk deteksi perubahan (mode, pilihan, arah)
function getCtxKey_(){
  const mode = ($('#mode')?.value || 'training');
  const tt   = ($('#training_type')?.value || '').trim();
  const act  = ($('#activity')?.value || '').trim();
  const mat  = ($('#material')?.value || '').trim();
  const reason = ($('#gate_reason')?.value || '').trim();
  const dir  = (State.gateDirection || '');
  // lokasi kita jadikan bagian key supaya ketika inFence berubah, status ikut update
  const locKey = (State.locError ? 'LOCERR' : (isFinite(State.loc.distance_m) ? (State.loc.inFence ? 'INFENCE' : 'OUTFENCE') : 'LOADING'));
  return [mode, tt, act, mat, reason, dir, locKey].join('|');
}

function needMaterial_(activity){
  const a = String(activity||'').trim().toLowerCase();
  return (a === 'sesi kelas' || a === 'field day');
}

// Hitung readiness + pesan “apa yang kurang” (lebih detail)
function computeReadiness_(){
  // 1) lokasi
  if (State.locError){
    return { ok:false, key:'LOC_ERR', msg:'Izin lokasi belum aktif. Klik <b>Cek Lokasi</b> lalu izinkan GPS.' };
  }
  if (!isFinite(State.loc.distance_m)){
    return { ok:false, key:'LOC_WAIT', msg:'Lokasi belum terdeteksi. Klik <b>Cek Lokasi</b>.' };
  }
  if (!State.loc.inFence){
    return { ok:false, key:'LOC_OUT', msg:`Di luar area presensi (${Math.round(State.loc.distance_m)} m). Dekati area Training Center.` };
  }

  // 2) mode
  const mode = ($('#mode')?.value || 'training');

  if (mode === 'training'){
    const tt  = ($('#training_type')?.value || '').trim();
    const act = ($('#activity')?.value || '').trim();
    const mat = ($('#material')?.value || '').trim();

    const missing = [];
    if (!tt) missing.push('Training Type');
    if (!act) missing.push('Activity');

    if (act && needMaterial_(act) && !mat) missing.push('Materi');

    if (missing.length){
      // pesan lebih spesifik
      return {
        ok:false,
        key:'TR_MISS_' + missing.join('_'),
        msg:`Belum siap presensi. Lengkapi: <b>${missing.join(', ')}</b>.`
      };
    }

    return {
      ok:true,
      key:'TR_OK',
      msg:`Siap presensi Training: <b>${escapeHtml(tt)}</b> / <b>${escapeHtml(act)}</b>${mat?(' • Materi: <b>'+escapeHtml(mat)+'</b>'):''}.`
    };
  }

    // gate / mobilitas 
  const reason = ($('#gate_reason')?.value || '').trim();
  const dir = State.gateDirection || '';

  // 1) Belum isi keperluan
  if (!reason){
    return {
      ok:false,
      key:'GT_NO_REASON',
      msg:'Belum siap presensi Mobilitas. Pilih / isi <b>Keperluan</b> terlebih dahulu.'
    };
  }

  // 2) Keperluan sudah ada -> status BERHASIL (siap)
  //    Arah akan otomatis di-set saat klik tombol Masuk/Keluar.
  const hint = dir
    ? `Arah: <b>${dir === 'IN' ? 'MASUK' : 'KELUAR'}</b>.`
    : `Klik tombol <b>Masuk</b> atau <b>Keluar</b> untuk mulai presensi.`;

  return {
    ok:true,
    key:'GT_OK',
    msg:`Siap presensi Mobilitas. Keperluan: <b>${escapeHtml(reason)}</b>.<br/>${hint}`
  };
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// Update status jika ada perubahan konteks / atau dipaksa
function smartStatusUpdate(force=false){
  if (State.ui.lastPresensiFailed){
  UI.setResult(State.ui.lastFailMessage, false);
  return;
}
  if (State.ui.statusLock) return;
  if (State.ui.outcomeLock) return;

  const ctxKey = getCtxKey_();
  if (!force && ctxKey === State.ui.lastCtxKey) return;

  State.ui.lastCtxKey = ctxKey;

  validateEnablePresensi();

  const st = computeReadiness_();
  const statusKey = st.key + '|' + (st.ok ? '1':'0');

  if (!force && statusKey === State.ui.lastStatusKey) return;
  State.ui.lastStatusKey = statusKey;

  // gunakan setResult supaya ikon ✅/❌ jelas
  UI.setResult(st.msg, !!st.ok);
}

function updatePresensiReadyMessage(){
  // delegasi ke smart engine
  smartStatusUpdate(true);
  return validateEnablePresensi();
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
  const reason = ($('#gate_reason')?.value || '').trim();
  if (!reason){
    setScanBadge('MOBILITAS: ISI KEPERLUAN', 'warn');
    return;
  }

  // keperluan sudah ada -> badge OK, arah opsional tampil kalau sudah dipilih
  const dir = State.gateDirection
    ? (State.gateDirection === 'IN' ? 'MASUK' : 'KELUAR')
    : 'SIAP';

  setScanBadge(`MOBILITAS: ${dir}`, 'ok');
}

/* =========================
   Materials suggest
   ========================= */
function debounce(fn, ms){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

function formatImportWarningsDetails(warnings, summaryText){
  const arr = Array.isArray(warnings) ? warnings : [];
  if (!arr.length) return '';

  const title = summaryText || `Warnings (${arr.length})`;

  const rowsHtml = arr.map((w, i)=>{
  const type = String(w.type || 'WARN').toUpperCase();
  const row  = escapeHtml(String(w.row ?? (i+1)));
  const nik  = escapeHtml(w.nik || '');
  const nama = escapeHtml(w.nama || w.nama_upload || '');
  const msg  = escapeHtml(w.message || '');

  const cls =
    /REJECT/i.test(type) ? 'danger' :
    /WARN/i.test(type)   ? 'warn' :
    'info';

  const extra = w.nama_existing
    ? `<div class="small" style="opacity:.85;">Existing: <b>${escapeHtml(w.nama_existing)}</b></div>`
    : '';

    return `
      <li>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="tag ${cls}">${escapeHtml(type)}</span>
          <div><b>#${row}</b> • NIK: <b>${nik}</b> • Nama: <b>${nama}</b></div>
        </div>
        <div class="small" style="margin-top:4px;">${msg}</div>
        ${extra}
      </li>
    `;
  }).join('');

  return `
    <details style="margin-top:10px;" open>
      <summary style="cursor:pointer;font-weight:900;">${escapeHtml(title)}</summary>
      <div class="warn-hint">
        Klik untuk melihat daftar baris yang ditolak/dilewati beserta alasannya.
      </div>
      <ol style="margin:0 0 0 18px;padding:0;">
        ${rowsHtml}
      </ol>
    </details>
  `;
}

function renderImportResultToUploadInfo(el, result, opts={}){
  if (!el) return;

  const ok = !!result?.ok;
  const inserted = Number(result?.inserted || 0);
  const updated  = Number(result?.updated || 0);

  const skippedEmpty = Number(result?.skipped_empty || 0);
  const rejTraining  = Number(result?.rejected_missing_training || 0);
  const rejConflict  = Number(result?.rejected_name_conflict || 0);

  const total = Number(result?.total_received || 0);

  const head = `
    <div style="font-weight:900;margin-bottom:6px;">
      ${ok ? '✅' : '❌'} ${ok ? 'UPLOAD OK' : 'UPLOAD ERROR'}
    </div>
    <div class="small">
      Total diterima: <b>${total}</b> • Insert: <b>${inserted}</b> • Update: <b>${updated}</b><br/>
      Skip kosong: <b>${skippedEmpty}</b> • Tolak jenis_pelatihan kosong: <b>${rejTraining}</b> • Tolak konflik nama: <b>${rejConflict}</b>
      ${opts.chunkInfo ? `<br/>${escapeHtml(opts.chunkInfo)}` : ''}
    </div>
  `;

  const warnings = result?.warnings || [];
  const details = formatImportWarningsDetails(
    warnings,
    opts.detailsTitle || `Warnings chunk (${Array.isArray(warnings)?warnings.length:0})`
  );

  el.innerHTML = head + (details || '');
}

function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(String(r.result || ''));
    r.onerror = ()=> reject(new Error('Gagal membaca file'));
    r.readAsDataURL(file);
  });
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
      statusSetLock(true);

      // ✅ jika izin lokasi belum ada / error, minta user keluar fullscreen dulu
      if (State.locError && document.fullscreenElement){
        presensiFailCam('Izin lokasi belum aktif. Tutup fullscreen lalu klik "Cek Lokasi" terlebih dahulu.');
        return;
      }

      await checkLocation({ force:false, silent:false, maxAgeMs:45000 });
      if (!State.loc.inFence){
        presensiFailCam('Anda di luar area geo-fence. Dekati area Training Center.');
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
          presensiFailCam('Silakan gunakan tombol Masuk atau Keluar.');
          return;
        }
      }

      // liveness
      const live = await runLiveness($('#video'));
      if (!live.ok){
        presensiFailCam('Liveness gagal. Coba lagi (cahaya cukup, wajah penuh di kamera).');
        return;
      }
      payload.liveness = live;

      UI.setResult('Memindai wajah (multi-shot)…', true);

      const descAvg = await captureMultiShotAvg($('#video'), 3, 2500);
      if (!descAvg){
        presensiFailCam('Wajah tidak stabil terdeteksi. Coba lagi.');
        return;
      }
      payload.descriptor_avg = descAvg;

      const r = await api('verifyAndLog', payload);

      if (r.ok){
        clearPresensiFail();

        UI.setResult(
          `Presensi diterima: <b>${escapeHtml(r.nama)}</b> (NIK: ${escapeHtml(r.nik)})<br/>
          Jarak center: ${Math.round(r.distance_m)} m<br/>
          Status: <b>${escapeHtml(r.status || '')}</b>`,
          true
        );

        camOutcomeShow(true,
          `Presensi diterima<br/><b>${escapeHtml(r.nama)}</b><br/><span class="small">Modal akan menutup otomatis…</span>`,
          { delayOkMs: 1600, closeOnOk: true }
        );

      } else {
        if (String(r.status || '').toUpperCase() === 'DUPLICATE_ATTEMPT'){
          presensiFailCam('Presensi duplikat terdeteksi.<br/>Jika barusan sudah presensi, tidak perlu ulang. (Anti-Duplicate Aktif)');
          return;
        }

        // ✅ semua error server -> overlay fail juga
        presensiFailCam(`${escapeHtml(r.error || 'Gagal')}<br/>Status: ${escapeHtml(r.status || '-')}`);
        return;
      }

    } catch(err){
      presensiFailCam(String(err?.message || err));
    } finally {
      if (!State.ui.outcomeLock){
        statusSetLock(false);
      }

      State.gateDirection = null;
      updateScanBadge();

      if (!State.ui.outcomeLock){
        smartStatusUpdate(true);
      }
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

      const descAvg = await captureMultiShotAvg($('#a_video'), 5, 4000);
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

/* =========================================================
   ✅ ENROLL ENHANCE: Local Master + Auto Suggest + Upload XLSX
   ========================================================= */

const ENROLL = {
  LS_KEY: 'enroll_master_local_v1',
  rows: [],            // [{nik,nama,jenis_pelatihan,tahun,lokasi_ojt,unit,region,group}]
  loadedFrom: '',      // 'server' | 'upload' | ''
};

function enrollNormStr(x){
  return String(x ?? '').trim();
}
function enrollNormNik(x){
  return enrollNormStr(x).replace(/\s+/g,'');
}
function enrollNameKey(x){
  return enrollNormStr(x).toLowerCase();
}

function enrollSaveToLS(){
  try{
    localStorage.setItem(ENROLL.LS_KEY, JSON.stringify({
      rows: ENROLL.rows,
      loadedFrom: ENROLL.loadedFrom,
      savedAt: Date.now()
    }));
  }catch(e){}
}
function enrollLoadFromLS(){
  try{
    const raw = localStorage.getItem(ENROLL.LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    ENROLL.rows = Array.isArray(obj.rows) ? obj.rows : [];
    ENROLL.loadedFrom = String(obj.loadedFrom || '');
  }catch(e){
    ENROLL.rows = [];
    ENROLL.loadedFrom = '';
  }
}

function enrollSetRows(rows, source){
  ENROLL.rows = (rows || []).map(r => ({
    nik: enrollNormNik(r.nik),
    nama: enrollNormStr(r.nama),
    jenis_pelatihan: enrollNormStr(r.jenis_pelatihan),
    tahun: r.tahun ?? '',
    lokasi_ojt: enrollNormStr(r.lokasi_ojt),
    unit: enrollNormStr(r.unit),
    region: enrollNormStr(r.region),
    group: enrollNormStr(r.group),
  })).filter(x => x.nik && x.nama);

  ENROLL.loadedFrom = source || '';
  enrollSaveToLS();
  enrollUpdateInfo();
}

function enrollClearLocal(){
  ENROLL.rows = [];
  ENROLL.loadedFrom = '';
  try{ localStorage.removeItem(ENROLL.LS_KEY); }catch(e){}
  enrollUpdateInfo();
}

function enrollUpdateInfo(){
  const el = document.getElementById('e_info');
  if (!el) return;

  if (!ENROLL.rows.length){
    el.textContent = 'Belum ada data peserta yang dimuat.';
    return;
  }

  el.textContent = `✅ Master lokal: ${ENROLL.rows.length} peserta (sumber: ${ENROLL.loadedFrom || 'local'})`;
}

function enrollSuggestFind(q, limit=8){
  q = enrollNormStr(q);
  if (!q || ENROLL.rows.length === 0) return [];

  const isNum = /^[0-9]+$/.test(q);
  const qLow = q.toLowerCase();

  // skor sederhana agar yang paling cocok di atas
  const scored = [];

  for (const r of ENROLL.rows){
    const nik = r.nik || '';
    const nama = r.nama || '';
    const namaLow = nama.toLowerCase();

    let score = -1;

    if (isNum){
      if (nik.startsWith(q)) score = 100 - (nik.length - q.length);
      else if (nik.includes(q)) score = 70;
      else if (namaLow.includes(qLow)) score = 40;
    } else {
      if (namaLow.startsWith(qLow)) score = 100 - (namaLow.length - qLow.length);
      else if (namaLow.includes(qLow)) score = 80;
      else if (nik.startsWith(q)) score = 60;
      else if (nik.includes(q)) score = 50;
    }

    if (score >= 0){
      scored.push({ r, score });
    }
  }

  scored.sort((a,b)=> b.score - a.score);
  return scored.slice(0, limit).map(x => x.r);
}

function enrollFillForm(r){
  if (!r) return;

  // Auto isi: NIK, Nama, Biodata (pakai Group)
  const nikEl  = document.getElementById('a_nik');
  const namaEl = document.getElementById('a_nama');
  const bioEl  = document.getElementById('a_bio');
  const noteEl = document.getElementById('a_note');

  if (nikEl) nikEl.value = r.nik || '';
  if (namaEl) namaEl.value = r.nama || '';

  // Biodata: fokus ke Group/Batch (sesuai permintaan)
  if (bioEl){
    bioEl.value = (r.group || '').trim();
  }

  // Catatan: opsional, tapi kita bantu isi info OJT (silakan ubah)
  if (noteEl && !noteEl.value){
    const parts = [];
    if (r.unit) parts.push(r.unit);
    if (r.region) parts.push(r.region);
    if (r.lokasi_ojt) parts.push('OJT: '+r.lokasi_ojt);
    noteEl.value = parts.join(' • ');
  }
}


/* =========================================================
   ✅ FIX ENROLL AUTO-SUGGEST (PORTAL, ANTI CLIP MODAL)
   - Dropdown ditempel ke document.body (tidak kepotong overflow modal)
   - Posisi fixed tepat di bawah input aktif
   - Works untuk #a_nik dan #a_nama
   ========================================================= */

function enrollEnsureSuggestUI(){
  // gunakan existing kalau ada, tapi jadikan "portal" ke body + fixed
  let wrap = document.getElementById('enroll-suggest');
  let list = document.getElementById('enroll-suggest-list');

  if (!wrap){
    wrap = document.createElement('div');
    wrap.id = 'enroll-suggest';
    wrap.className = 'suggest hidden';
  }

  if (!list){
    list = document.createElement('div');
    list.id = 'enroll-suggest-list';
    wrap.appendChild(list);
  }

  // ✅ PENTING: pastikan wrap menjadi child dari body (hindari clip modal)
  if (wrap.parentElement !== document.body){
    document.body.appendChild(wrap);
  }

  // ✅ paksa style portal (override inline HTML Anda)
  wrap.style.position = 'fixed';
  wrap.style.zIndex = '99999';
  wrap.style.left = '0px';
  wrap.style.top = '0px';
  wrap.style.width = '280px';
  wrap.style.maxHeight = '260px';
  wrap.style.overflow = 'auto';
  wrap.style.borderRadius = '12px';
  wrap.style.boxShadow = '0 18px 40px rgba(0,0,0,.35)';

  // background ikut tema: pakai CSS variable kalau ada
  wrap.style.background = 'var(--card, #111827)';
  wrap.style.border = '1px solid rgba(255,255,255,.12)';

  // list tidak perlu absolute lagi (biar simpel)
  list.style.position = 'static';

  return { wrap, list };
}

function enrollPositionSuggestUnder(inputEl){
  if (!inputEl) return;
  const { wrap } = enrollEnsureSuggestUI();

  const r = inputEl.getBoundingClientRect();
  const gap = 6;

  // fixed: pakai viewport coords (tanpa scrollY)
  wrap.style.left = Math.max(8, Math.round(r.left)) + 'px';
  wrap.style.top  = Math.round(r.bottom + gap) + 'px';
  wrap.style.width = Math.max(240, Math.round(r.width)) + 'px';
}

function enrollSuggestHide(){
  const wrap = document.getElementById('enroll-suggest');
  const list = document.getElementById('enroll-suggest-list');
  if (wrap) wrap.classList.add('hidden');
  if (list) list.innerHTML = '';
}

function enrollSuggestShow(items){
  const { wrap, list } = enrollEnsureSuggestUI();

  if (!items || items.length === 0){
    enrollSuggestHide();
    return;
  }

  wrap.classList.remove('hidden');

  list.innerHTML = items.map((r, i)=>`
    <div class="sug-item" data-i="${i}">
      <div style="min-width:0;">
        <b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">
          ${escapeHtml(r.nama || '-')}
        </b>
        <div class="sug-mini">${escapeHtml(r.group || r.jenis_pelatihan || '')}</div>
      </div>
      <div class="sug-mini" style="text-align:right;flex-shrink:0;">
        <div><b>${escapeHtml(r.nik || '')}</b></div>
        <div>${escapeHtml(r.unit || r.region || '')}</div>
      </div>
    </div>
  `).join('');

  // ✅ mousedown supaya tidak kalah oleh blur input
  list.querySelectorAll('.sug-item').forEach(el=>{
    el.addEventListener('mousedown', (e)=>{
      e.preventDefault();
      const idx = Number(el.getAttribute('data-i'));
      const chosen = items[idx];
      enrollFillForm(chosen);
      enrollSuggestHide();
      UI.setAdminResult(`Auto-isi dari master: ${chosen.nama}`, true);
      document.getElementById('a_bio')?.focus?.();
    });
  });
}

function enrollBindAutoSuggest(){
  const nikEl  = document.getElementById('a_nik');
  const namaEl = document.getElementById('a_nama');
  if (!nikEl && !namaEl) return;

  // hindari bind dobel
  if (State._enrollSuggestBound) return;
  State._enrollSuggestBound = true;

  enrollEnsureSuggestUI();

  const runSearch = debounce((activeEl)=>{
    if (!ENROLL.rows.length){
      enrollSuggestHide();
      return;
    }

    const q = String(activeEl?.value || '').trim();
    if (!q){
      enrollSuggestHide();
      return;
    }

    enrollPositionSuggestUnder(activeEl);

    const items = enrollSuggestFind(q, 8);
    enrollSuggestShow(items);
  }, 120);

  const bindOne = (el)=>{
    if (!el) return;
    el.setAttribute('autocomplete','off');

    el.addEventListener('input', ()=> runSearch(el));
    el.addEventListener('focus', ()=> runSearch(el));

    el.addEventListener('blur', ()=>{
      setTimeout(()=> enrollSuggestHide(), 180);
    });

    el.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') enrollSuggestHide();
    });
  };

  bindOne(nikEl);
  bindOne(namaEl);

  // klik luar untuk tutup
  document.addEventListener('mousedown', (e)=>{
    const wrap = document.getElementById('enroll-suggest');
    const list = document.getElementById('enroll-suggest-list');
    if (!wrap || !list) return;

    const t = e.target;
    if (t === nikEl || t === namaEl) return;
    if (wrap.contains(t)) return;

    enrollSuggestHide();
  });

  // reposition saat scroll/resize jika dropdown sedang tampil
  const reposition = ()=>{
    const wrap = document.getElementById('enroll-suggest');
    if (!wrap || wrap.classList.contains('hidden')) return;

    const active =
      (document.activeElement === nikEl) ? nikEl :
      (document.activeElement === namaEl) ? namaEl : null;

    if (active) enrollPositionSuggestUnder(active);
  };

  window.addEventListener('scroll', reposition, { passive:true });
  window.addEventListener('resize', reposition);
}

/*
// ✅ override: show harus selalu reposition
const _enrollSuggestShowOrig = enrollSuggestShow;
enrollSuggestShow = function(items){
  const { wrap, list } = enrollEnsureSuggestUI();

  if (!items || items.length === 0){
    enrollSuggestHide();
    return;
  }

  wrap.classList.remove('hidden');

  list.innerHTML = items.map((r, i)=>`
    <div class="sug-item" data-i="${i}" style="
      display:flex;justify-content:space-between;gap:10px;
      padding:10px 12px; cursor:pointer; border-bottom:1px solid rgba(0,0,0,.06);
    ">
      <div style="min-width:0;">
        <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(r.nama || '-')}
        </div>
        <div class="sug-mini" style="opacity:.8;font-size:12px;">
          ${escapeHtml(r.group || r.jenis_pelatihan || '')}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-weight:900;font-size:12px;">${escapeHtml(r.nik || '')}</div>
        <div class="sug-mini" style="opacity:.8;font-size:12px;">
          ${escapeHtml(r.unit || r.region || '')}
        </div>
      </div>
    </div>
  `).join('');

  // click pilih
  list.querySelectorAll('.sug-item').forEach(el=>{
    el.addEventListener('mousedown', (e)=>{
      // mousedown supaya tidak “kalah” oleh blur input
      e.preventDefault();
      const idx = Number(el.getAttribute('data-i'));
      const chosen = items[idx];
      enrollFillForm(chosen);
      enrollSuggestHide();
      UI.setAdminResult(`Auto-isi dari master: ${chosen.nama}`, true);

      // fokus ke field berikutnya biar enak
      document.getElementById('a_bio')?.focus?.();
    });
  });
};

*/

/* -------------------------
   Load master dari server (filter TT + Group)
   - pakai action adminPesertaList (yang sudah ada di aplikasi Anda)
   ------------------------- */
async function enrollLoadFromServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const tt = (document.getElementById('e_training_type')?.value || '').trim();
  const gp = (document.getElementById('e_group')?.value || '').trim();
  if (!tt || !gp){
    UI.setAdminResult('Pilih Training Type & Batch/Group terlebih dahulu.', false);
    return;
  }

  const r = await api('adminPesertaList', {
    admin_token: State.adminToken,
    training_type: tt,
    group: gp,
    q: '',
    limit: 1200
  });

  if (!r.ok) throw new Error(r.error || 'Gagal load peserta (server)');

  // r.items minimal berisi nik,nama,batch/group; kalau kolom lain tidak ada, aman (fallback kosong)
  const rows = (r.items || []).map(x=>({
    nik: x.nik,
    nama: x.nama,
    jenis_pelatihan: x.jenis_pelatihan || tt,
    tahun: x.tahun || '',
    lokasi_ojt: x.lokasi_ojt || '',
    unit: x.unit || '',
    region: x.region || '',
    group: x.group || x.batch || gp
  }));

  enrollSetRows(rows, 'server');
  UI.setAdminResult(`Master peserta dimuat: ${rows.length} orang. Ketik NIK/Nama untuk sugesti.`, true);
}

/* -------------------------
   Upload XLSX -> parse -> kirim ke GAS (adminPesertaImport)
   ------------------------- */

function enrollEnsureXlsxLib(){
  return !!window.XLSX;
}

function enrollParseXlsx(file){
  return new Promise((resolve, reject)=>{
    if (!enrollEnsureXlsxLib()){
      return reject(new Error('Library XLSX belum tersedia. Tambahkan xlsx.full.min.js (SheetJS) terlebih dahulu.'));
    }
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type:'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws, { defval:'' }); // array of objects
        resolve(json);
      }catch(err){
        reject(err);
      }
    };
    reader.onerror = ()=> reject(new Error('Gagal membaca file XLSX'));
    reader.readAsArrayBuffer(file);
  });
}

function enrollValidateTemplate(rows){
  const need = ['nik','nama','jenis_pelatihan','tahun','lokasi_ojt','unit','region','group'];
  const first = rows && rows[0] ? Object.keys(rows[0]) : [];
  const missing = need.filter(k => !first.includes(k));
  if (missing.length){
    throw new Error('Format template tidak sesuai. Kolom kurang: ' + missing.join(', '));
  }
}

function chunkArray(arr, size){
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
  return out;
}

async function enrollUploadXlsxToServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const fileEl = document.getElementById('e_file');
  const infoEl = document.getElementById('e_upload_info');
  const f = fileEl?.files?.[0];
  if (!f) throw new Error('Pilih file .xlsx terlebih dahulu.');

  if (infoEl) infoEl.textContent = '⏳ Membaca XLSX…';

  const rawRows = await enrollParseXlsx(f);
  if (!rawRows.length) throw new Error('XLSX kosong / tidak ada data.');

  enrollValidateTemplate(rawRows);

  // normalisasi
  const rows = rawRows.map(r => ({
    nik: enrollNormNik(r.nik),
    nama: enrollNormStr(r.nama),
    jenis_pelatihan: enrollNormStr(r.jenis_pelatihan),
    tahun: r.tahun ?? '',
    lokasi_ojt: enrollNormStr(r.lokasi_ojt),
    unit: enrollNormStr(r.unit),
    region: enrollNormStr(r.region),
    group: enrollNormStr(r.group),
  })).filter(x => x.nik && x.nama);

  if (!rows.length) throw new Error('Data valid 0 baris (cek kolom nik/nama).');

  // kirim per-chunk biar aman payload
  const chunks = chunkArray(rows, 200);

  // ✅ akumulasi hasil
  const allWarnings = [];
  const agg = {
    inserted: 0,
    updated: 0,
    skipped_empty: 0,
    rejected_missing_training: 0,
    rejected_name_conflict: 0,
    total_received: 0
  };

  for (let i=0;i<chunks.length;i++){
    if (infoEl) infoEl.innerHTML = `<div class="small">⏳ Upload chunk ${i+1}/${chunks.length}…</div>`;

    const r = await api('adminPesertaImport', {
      admin_token: State.adminToken,
      rows: chunks[i]
    });

    if (!r.ok){
      // tampilkan error + raw
      if (infoEl){
        infoEl.innerHTML = `
          <div style="font-weight:900;margin-bottom:6px;">❌ Upload gagal</div>
          <div class="small">${escapeHtml(r.error || 'Unknown error')}</div>
        `;
      }
      throw new Error(r.error || `Upload gagal di chunk ${i+1}`);
    }

    // ✅ agregasi angka
    agg.inserted += Number(r.inserted || 0);
    agg.updated  += Number(r.updated  || 0);
    agg.skipped_empty += Number(r.skipped_empty || 0);
    agg.rejected_missing_training += Number(r.rejected_missing_training || 0);
    agg.rejected_name_conflict += Number(r.rejected_name_conflict || 0);
    agg.total_received += Number(r.total_received || 0);

    // ✅ kumpulkan warnings (batasi supaya tidak meledak)
    if (Array.isArray(r.warnings) && r.warnings.length){
      // tambahkan info chunk supaya mudah ditelusuri
      r.warnings.forEach(w=>{
        allWarnings.push({ ...w, chunk: i+1 });
      });
    }

    // ✅ tampilkan result chunk + warnings dalam <details>
    if (infoEl){
      // kita sisipkan info chunk pada title, dan buat details berisi warnings chunk ini
      const chunkInfo = `Progress: ${i+1}/${chunks.length} • (chunk size: ${chunks[i].length})`;
      renderImportResultToUploadInfo(infoEl, r, {
        chunkInfo,
        detailsTitle: `Warnings chunk ${i+1} (${(r.warnings||[]).length})`
      });
    }
  }

  // ✅ Ringkasan akhir + warnings gabungan
  if (infoEl){
    const summaryHtml = `
      <div style="font-weight:900;margin-bottom:6px;">✅ Upload selesai</div>
      <div class="small">
        File: <b>${escapeHtml(f.name)}</b><br/>
        Total data: <b>${rows.length}</b> • Insert: <b>${agg.inserted}</b> • Update: <b>${agg.updated}</b><br/>
        Skip kosong: <b>${agg.skipped_empty}</b> • Tolak jenis_pelatihan kosong: <b>${agg.rejected_missing_training}</b> • Tolak konflik nama: <b>${agg.rejected_name_conflict}</b>
      </div>
    `;

    // group warnings (tampilkan sampai 200 seperti backend, tapi bisa lebih karena akumulasi chunk)
    const detailsAll = formatImportWarningsDetails(
      allWarnings.slice(0, 800), // batasi render UI (silakan naik/turun)
      `Warnings total (${allWarnings.length})`
    );

    infoEl.innerHTML = summaryHtml + (detailsAll || '');
  }

  // Setelah upload, set master lokal juga supaya langsung bisa sugest
  enrollSetRows(rows, 'upload');

  // ✅ hasil admin modal
  if (allWarnings.length){
    UI.setAdminResult(`Upload peserta selesai. Ada ${allWarnings.length} warning (klik detail di bawah).`, true);
  } else {
    UI.setAdminResult(`Upload peserta sukses (${rows.length}). Tidak ada warning.`, true);
  }
}

/* -------------------------
   Download template (file statis di folder template)
   ------------------------- */
function enrollDownloadTemplate(){
  const TEMPLATE_URL = './template/master_peserta.xlsx';
  const a = document.createElement('a');
  a.href = TEMPLATE_URL;
  a.download = 'master_peserta.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* -------------------------
   Init enroll enhance (dipanggil saat admin login)
   ------------------------- */
function initEnrollEnhance(){
  // restore master dari LS (kalau ada)
  enrollLoadFromLS();
  enrollUpdateInfo();
  enrollBindAutoSuggest();

  // isi dropdown enroll dari meta (pakai meta dashboard agar konsisten)
  const meta = State._dashMeta || {};
  const ttEl = document.getElementById('e_training_type');
  const grpEl = document.getElementById('e_group');

  if (ttEl && grpEl){
    const trainingTypes = (meta.jenis_pelatihan || meta.training_types || []);
    fillSelect(ttEl, trainingTypes, 'Pilih Training Type…');

    const refreshGroups = ()=>{
      const tt = (ttEl.value || '').trim();
      const groupsByType = meta.groups_by_training_type || {};
      const groups = tt ? (groupsByType[tt] || []) : (meta.groups || []);
      fillSelect(grpEl, groups, 'Pilih Batch…');
    };

    ttEl.addEventListener('change', refreshGroups);
    refreshGroups();
  }

  // bind buttons
  document.getElementById('btn-e-load')?.addEventListener('click', ()=> Busy.wrap(
    document.getElementById('btn-e-load'),
    async()=> await enrollLoadFromServer(),
    { text:'Memuat…', overlay:true, overlayText:'Memuat master peserta dari server…' }
  ));

  document.getElementById('btn-e-clear')?.addEventListener('click', ()=>{
    if (!confirm('Clear data master lokal? (Auto-suggest akan kosong)')) return;
    enrollClearLocal();
    UI.setAdminResult('Master lokal dibersihkan.', true);
  });

  document.getElementById('btn-e-template')?.addEventListener('click', ()=>{
    enrollDownloadTemplate();
  });

  document.getElementById('btn-e-upload')?.addEventListener('click', ()=> Busy.wrap(
    document.getElementById('btn-e-upload'),
    async()=> await enrollUploadXlsxToServer(),
    { text:'Upload…', overlay:true, overlayText:'Upload master peserta (XLSX) ke server…' }
  ));
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

    // ✅ NameTag: Layout + Slider bounds
    const NTLY = r.nametag_layouts || ntDefaultLayouts();
    const setLayout = (k)=>{
      const o = NTLY[k] || {};
      const colsEl = document.getElementById(`s_nt_${k}_cols`);
      const padEl  = document.getElementById(`s_nt_${k}_pad`);
      const gapEl  = document.getElementById(`s_nt_${k}_gap`);
      if (colsEl) colsEl.value = Number(o.cols ?? (k==='2up'?1:(k==='12up'?3:2)));
      if (padEl)  padEl.value  = Number(o.pad  ?? 8);
      if (gapEl)  gapEl.value  = Number(o.gap  ?? 4);
    };
    ['2up','4up','6up','8up','10up','12up'].forEach(setLayout);

    const B = r.nametag_slider_bounds || ntDefaultSliderBounds();
    const setB = (key, elMin, elMax, elDef)=>{
      const b = B[key] || {};
      if (document.getElementById(elMin)) document.getElementById(elMin).value = Number(b.min ?? 0);
      if (document.getElementById(elMax)) document.getElementById(elMax).value = Number(b.max ?? 0);
      if (document.getElementById(elDef)) document.getElementById(elDef).value = Number(b.def ?? 0);
    };

    setB('head_fs','s_nt_head_fs_min','s_nt_head_fs_max','s_nt_head_fs_def');
    setB('head_y', 's_nt_head_y_min', 's_nt_head_y_max', 's_nt_head_y_def');
    setB('sub_fs', 's_nt_sub_fs_min', 's_nt_sub_fs_max', 's_nt_sub_fs_def');
    setB('sub_y',  's_nt_sub_y_min',  's_nt_sub_y_max',  's_nt_sub_y_def');
    setB('name_fs','s_nt_name_fs_min','s_nt_name_fs_max','s_nt_name_fs_def');
    setB('name_y', 's_nt_name_y_min', 's_nt_name_y_max', 's_nt_name_y_def');
    setB('photo_s','s_nt_photo_s_min','s_nt_photo_s_max','s_nt_photo_s_def');
    setB('photo_y', 's_nt_photo_y_min','s_nt_photo_y_max','s_nt_photo_y_def');

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

    const device_detect_enabled = ($('#s_devdet_enabled').value || 'TRUE') === 'TRUE';

    // ✅ build NameTag layouts from UI (WAJIB sebelum api call)
    const readLayout = (k, per, defCols)=>{
      const cols = Number(document.getElementById(`s_nt_${k}_cols`)?.value ?? defCols);
      const pad  = Number(document.getElementById(`s_nt_${k}_pad`)?.value  ?? 8);
      const gap  = Number(document.getElementById(`s_nt_${k}_gap`)?.value  ?? 4);
      return { per, cols, pad, gap };
    };

    const nametag_layouts = {
      '2up' : readLayout('2up', 2, 1),
      '4up' : readLayout('4up', 4, 2),
      '6up' : readLayout('6up', 6, 2),
      '8up' : readLayout('8up', 8, 2),
      '10up': readLayout('10up',10,2),
      '12up': readLayout('12up',12,3),
    };

    // ✅ build Slider bounds from UI (WAJIB sebelum api call)
    const readBound = (key)=>{
      const min = Number(document.getElementById(`s_nt_${key}_min`)?.value ?? 0);
      const max = Number(document.getElementById(`s_nt_${key}_max`)?.value ?? 0);
      const def = Number(document.getElementById(`s_nt_${key}_def`)?.value ?? 0);
      return { min, max, def };
    };

    const nametag_slider_bounds = {
      head_fs: readBound('head_fs'),
      head_y:  readBound('head_y'),
      sub_fs:  readBound('sub_fs'),
      sub_y:   readBound('sub_y'),
      name_fs: readBound('name_fs'),
      name_y:  readBound('name_y'),
      photo_s: readBound('photo_s'),
      photo_y: readBound('photo_y'),
    };

    // ✅ baru panggil API
    const r = await api('adminUpdateSettings', {
      admin_token: State.adminToken,
      geofence_lat, geofence_lng, geofence_radius_m,
      face_threshold,
      liveness_enabled,
      liveness_mode,
      ear_low, ear_high,
      turn_thresh,
      liveness_duration_ms,
      device_detect_enabled,
      nametag_layouts,
      nametag_slider_bounds
    });

    if (!r.ok) throw new Error(r.error || 'Gagal simpan settings');

    if (r.cfg) State.cfg = { ok:true, ...r.cfg };
    try{ ntApplySliderBoundsFromCfg(); ntRenderPreview(); }catch(e){}

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

/* =========================================================
   ✅ TRAINING META (Jenis Pelatihan & Kegiatan) - Public + Cache
   ========================================================= */
const TRAIN_META = {
  LS_KEY: 'training_meta_local_v1',
  data: { training_types: [], activities: [], savedAt: 0 }
};

function tmLoadFromLS(){
  try{
    const raw = localStorage.getItem(TRAIN_META.LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj) return;
    TRAIN_META.data = {
      training_types: Array.isArray(obj.training_types) ? obj.training_types : [],
      activities: Array.isArray(obj.activities) ? obj.activities : [],
      savedAt: Number(obj.savedAt || 0)
    };
  }catch(e){}
}

function tmSaveToLS(){
  try{
    localStorage.setItem(TRAIN_META.LS_KEY, JSON.stringify(TRAIN_META.data));
  }catch(e){}
}

function tmApplyToPesertaUI(){
  const ttEl = document.getElementById('training_type');
  const acEl = document.getElementById('activity');
  if (!ttEl || !acEl) return;

  const curTT = ttEl.value || State.lastTrainingType || '';
  const curAC = acEl.value || State.lastActivity || '';

  const tts = (TRAIN_META.data.training_types || []).slice();
  const acts = (TRAIN_META.data.activities || []).slice();

  fillSelect(ttEl, tts, 'Pilih…');
  fillSelect(acEl, acts, 'Pilih…');

  if (curTT && tts.includes(curTT)) ttEl.value = curTT;
  if (curAC && acts.includes(curAC)) acEl.value = curAC;

  // re-run rule materi
  try{ toggleMaterial(); }catch(e){}
  try{ updateScanBadge(); }catch(e){}
  try{ validateEnablePresensi(); }catch(e){}
}

async function tmLoadFromServer(force=false){
  // cache 24 jam (silakan ubah)
  const maxAgeMs = 24 * 60 * 60 * 1000;
  const age = Date.now() - Number(TRAIN_META.data.savedAt || 0);

  if (!force && TRAIN_META.data.training_types.length && age < maxAgeMs){
    tmApplyToPesertaUI();
    return;
  }

  const r = await api('trainingMetaPublic', { t: Date.now() });
  if (!r.ok) throw new Error(r.error || 'Gagal load training meta');

  TRAIN_META.data.training_types = Array.isArray(r.training_types) ? r.training_types : [];
  TRAIN_META.data.activities = Array.isArray(r.activities) ? r.activities : [];
  TRAIN_META.data.savedAt = Date.now();

  tmSaveToLS();
  tmApplyToPesertaUI();
}

/* =========================================================
   ✅ ADMIN: TRAINING META CRUD
   ========================================================= */

function tmResetForm(){
  $('#tm_id').value = '';
  $('#tm_kind').value = 'training_type';
  $('#tm_name').value = '';
  $('#tm_active').value = 'TRUE';
  $('#tm_sort').value = '0';
}

function tmRowBtnHtml(id){
  return `
    <button class="btn" data-tm-edit="${escapeHtml(id)}" type="button">Edit</button>
    <button class="btn danger" data-tm-del="${escapeHtml(id)}" type="button">Hapus</button>
  `;
}

function tmRenderTables(items){
  const tbType = document.querySelector('#tm_tbl_type tbody');
  const tbAct  = document.querySelector('#tm_tbl_act tbody');
  if (!tbType || !tbAct) return;

  const byKind = (k)=> (items||[]).filter(x=>String(x.kind)===k);

  const render = (arr)=> arr.map(x=>`
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>${escapeHtml(String(x.sort ?? 0))}</td>
      <td>${x.active ? 'TRUE' : 'FALSE'}</td>
      <td>${tmRowBtnHtml(x.id)}</td>
    </tr>
  `).join('');

  tbType.innerHTML = render(byKind('training_type'));
  tbAct.innerHTML  = render(byKind('activity'));

  // bind edit/delete
  document.querySelectorAll('[data-tm-edit]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const id = b.getAttribute('data-tm-edit');
      const it = (items||[]).find(z=>String(z.id)===String(id));
      if (!it) return;
      $('#tm_id').value = it.id;
      $('#tm_kind').value = it.kind;
      $('#tm_name').value = it.name;
      $('#tm_active').value = it.active ? 'TRUE' : 'FALSE';
      $('#tm_sort').value = String(it.sort ?? 0);
      $('#tm_info').textContent = `Edit: ${it.id}`;
    });
  });

  document.querySelectorAll('[data-tm-del]').forEach(b=>{
    b.addEventListener('click', async()=>{
      const id = b.getAttribute('data-tm-del');
      if (!confirm('Hapus item ini?')) return;
      await adminTrainingMetaDelete(id);
    });
  });
}

async function adminTrainingMetaList(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminTrainingMetaList', { admin_token: State.adminToken });
  if (!r.ok) throw new Error(r.error || 'Gagal load training meta');

  State._trainingMetaItems = r.items || [];
  tmRenderTables(State._trainingMetaItems);
  $('#tm_info').textContent = `Loaded: ${(State._trainingMetaItems||[]).length} item`;

  // ✅ refresh peserta dropdown juga (public cache)
  try{ await tmLoadFromServer(true); }catch(e){}
}

async function adminTrainingMetaSave(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const id = ($('#tm_id').value || '').trim();
  const kind = ($('#tm_kind').value || 'training_type').trim();
  const name = ($('#tm_name').value || '').trim();
  const active = ($('#tm_active').value || 'TRUE') === 'TRUE';
  const sort = Number($('#tm_sort').value || 0);

  if (!name) throw new Error('Nama wajib diisi.');
  if (!['training_type','activity'].includes(kind)) throw new Error('Kind tidak valid.');

  const r = await api('adminTrainingMetaUpsert', {
    admin_token: State.adminToken,
    id, kind, name, active, sort
  });
  if (!r.ok) throw new Error(r.error || 'Gagal simpan');

  $('#tm_info').textContent = `✅ Tersimpan: ${r.id}`;
  tmResetForm();
  await adminTrainingMetaList();
}

async function adminTrainingMetaDelete(id){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const r = await api('adminTrainingMetaDelete', { admin_token: State.adminToken, id });
  if (!r.ok) throw new Error(r.error || 'Gagal hapus');
  $('#tm_info').textContent = '✅ ' + (r.message || 'Terhapus');
  await adminTrainingMetaList();
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

/* =========================================================
   ✅ ADMIN: NAME TAG GENERATOR (2 template + preview + print)
   ========================================================= */

const NT = {
  LS_KEY: 'nametag_event_v1',
  LS_PICK_KEY: 'nametag_picked_local_v1',
  photoCache: {},       // nik -> dataUrl
  queue: [],            // [{nik,nama,batch,photoUrl?}]
  selectedNik: '',

  pickedSet: new Set(),
  lastRows: []  
};

function ntDefaultLayouts(){
  return {
    '2up' : { per:2,  cols:1, pad:10, gap:8 },
    '4up' : { per:4,  cols:2, pad:8,  gap:6 },
    '6up' : { per:6,  cols:2, pad:8,  gap:5 },
    '8up' : { per:8,  cols:2, pad:8,  gap:4 },
    '10up': { per:10, cols:2, pad:8,  gap:3 },
    '12up': { per:12, cols:3, pad:7,  gap:3 },
  };
}

function ntDefaultSliderBounds(){
  return {
    head_fs:  { min:6,   max:32,  def:14 },
    head_y:   { min:-80, max:60,  def:0  },
    sub_fs:   { min:6,   max:32,  def:12 },
    sub_y:    { min:-80, max:100, def:0  },
    name_fs:  { min:6,   max:100, def:44 },
    name_y:   { min:-80, max:80,  def:0  },
    photo_s:  { min:50,  max:300, def:160},
    photo_y:  { min:-80, max:80,  def:0  }
  };
}

function ntApplySliderBoundsFromCfg(){
  const B = (State.cfg && State.cfg.nametag_slider_bounds) ? State.cfg.nametag_slider_bounds : null;
  const bounds = B || ntDefaultSliderBounds();

  const map = [
    ['head_fs','nt_head_fs'],
    ['head_y','nt_head_y'],
    ['sub_fs','nt_sub_fs'],
    ['sub_y','nt_sub_y'],
    ['name_fs','nt_name_fs'],
    ['name_y','nt_name_y'],
    ['photo_s','nt_photo_s'],
    ['photo_y','nt_photo_y'],
  ];

  map.forEach(([k, id])=>{
    const el = document.getElementById(id);
    if (!el) return;
    const b = bounds[k] || {};
    if (Number.isFinite(b.min)) el.min = String(b.min);
    if (Number.isFinite(b.max)) el.max = String(b.max);

    // jangan paksa overwrite value user kalau sudah ada,
    // tapi pastikan tetap dalam range
    const v = Number(el.value);
    const mn = Number(el.min);
    const mx = Number(el.max);

    if (!isFinite(v) && Number.isFinite(b.def)) el.value = String(b.def);
    else if (isFinite(v) && isFinite(mn) && v < mn) el.value = String(mn);
    else if (isFinite(v) && isFinite(mx) && v > mx) el.value = String(mx);
  });
}

function ntLoadSettings(){
  const raw = localStorage.getItem(NT.LS_KEY);
  let s = {};
  try{ s = raw ? JSON.parse(raw) : {}; }catch(e){}
  return {
    type: s.type || 'A',
    bg: s.bg || 'dark',
    event: s.event || '',
    loc: s.loc || '',
    date: s.date || '',
    layout: s.layout || '2up',

    // dataURL (bisa besar, tapi masih aman untuk logo kecil)
    logo: s.logo || '',
    cologo: s.cologo || '',

    // ✅ cascading
    training_type: s.training_type || '',
    group: s.group || '',

    name_fs: Number(s.name_fs || 44),
    name_y: Number(s.name_y || 0),
    photo_s: Number(s.photo_s || 160),
    photo_y: Number(s.photo_y || 0),

    // ✅ Header adjust
    head_fs: Number(s.head_fs || 14),   // ukuran header (px)
    head_y:  Number(s.head_y  || 0),    // naik/turun header (px)
    sub_fs:  Number(s.sub_fs  || 12),   // ukuran subheader (px)
    sub_y:   Number(s.sub_y   || 0),    // naik/turun subheader (px)
  };
}

function ntSaveSettingsToLS(s){
  localStorage.setItem(NT.LS_KEY, JSON.stringify(s));
}

function ntReadSettingsFromUI(){
  return {
    type: ($('#nt_type').value || 'A'),
    bg: ($('#nt_bg').value || 'dark'),
    event: ($('#nt_event').value || '').trim(),
    loc: ($('#nt_loc').value || '').trim(),
    date: ($('#nt_date').value || '').trim(),
    layout: ($('#nt_layout').value || '2up'),

    // ✅ sekarang logo disimpan sebagai DataURL di hidden input
    logo: ($('#nt_logo').value || '').trim(),
    cologo: ($('#nt_cologo').value || '').trim(),

    // ✅ cascading filter di NameTag
    training_type: ($('#nt_training_type')?.value || '').trim(),
    group: ($('#nt_group')?.value || '').trim(),

    name_fs: Number($('#nt_name_fs').value || 44),
    name_y: Number($('#nt_name_y').value || 0),
    photo_s: Number($('#nt_photo_s').value || 160),
    photo_y: Number($('#nt_photo_y').value || 0),

    // ✅ Header adjust
    head_fs: Number($('#nt_head_fs')?.value || 14),
    head_y:  Number($('#nt_head_y')?.value  || 0),
    sub_fs:  Number($('#nt_sub_fs')?.value  || 12),
    sub_y:   Number($('#nt_sub_y')?.value   || 0),
  };
}

function ntApplySettingsToUI(s){
  $('#nt_type').value = s.type;
  $('#nt_bg').value = s.bg;
  $('#nt_event').value = s.event;
  $('#nt_loc').value = s.loc;
  $('#nt_date').value = s.date;
  $('#nt_layout').value = s.layout;

  // ✅ hidden input dataURL
  $('#nt_logo').value = s.logo || '';
  $('#nt_cologo').value = s.cologo || '';

  // info kecil
  const li = $('#nt_logo_info');
  if (li) li.textContent = s.logo ? '✅ Logo terset' : '-';
  const ci = $('#nt_cologo_info');
  if (ci) ci.textContent = s.cologo ? '✅ Co-Logo terset' : '-';

  // ✅ cascading
  if ($('#nt_training_type')) $('#nt_training_type').value = s.training_type || '';
  if ($('#nt_group')) $('#nt_group').value = s.group || '';

  $('#nt_name_fs').value = String(s.name_fs);
  $('#nt_name_y').value  = String(s.name_y);
  $('#nt_photo_s').value = String(s.photo_s);
  $('#nt_photo_y').value = String(s.photo_y);

  // ✅ Header adjust
  if ($('#nt_head_fs')) $('#nt_head_fs').value = String(s.head_fs ?? 14);
  if ($('#nt_head_y'))  $('#nt_head_y').value  = String(s.head_y  ?? 0);
  if ($('#nt_sub_fs'))  $('#nt_sub_fs').value  = String(s.sub_fs  ?? 12);
  if ($('#nt_sub_y'))   $('#nt_sub_y').value   = String(s.sub_y   ?? 0);
}

function ntCardHtml({settings, peserta, photoUrl}){
  const logo = settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="logo">` : '';
  const cologo = settings.cologo ? `<img src="${escapeHtml(settings.cologo)}" alt="co-logo">` : '';

  const head = `
    <div class="nt-head">
      <div class="nt-logos">${logo}</div>
      <div class="nt-headtxt" style="transform: translateY(var(--nt-head-y));">
        <div class="nt-event" style="font-size: var(--nt-head-fs);">
          ${escapeHtml(settings.event || '-')}
        </div>
        <div class="nt-sub" style="font-size: var(--nt-sub-fs); transform: translateY(var(--nt-sub-y));">
          ${escapeHtml(settings.loc || '-')}${settings.date ? ' • ' + escapeHtml(settings.date) : ''}
        </div>
      </div>
      <div class="nt-logos">${cologo}</div>
    </div>
  `;

  const photo = `
    <div class="nt-photo">
      <img src="${escapeHtml(photoUrl || '')}" alt="photo" onerror="this.style.display='none'">
    </div>
  `;

  return `
    ${head}
    ${settings.type === 'B' ? photo : ''}
    <div class="nt-name">${escapeHtml(peserta?.nama || '-')}</div>
    <div class="nt-foot">NIK: ${escapeHtml(peserta?.nik || '-')} ${peserta?.batch ? ' • ' + escapeHtml(peserta.batch) : ''}</div>
  `;
}

function ntRenderPreview(){
  const s = ntReadSettingsFromUI();
  ntSaveSettingsToLS(s);

  const card = $('#nt_preview');
  if (!card) return;

  // class template + bg
  card.classList.remove('nt-typeA','nt-typeB','nt-bg-dark','nt-bg-green','nt-bg-plain');
  card.classList.add(s.type === 'B' ? 'nt-typeB' : 'nt-typeA');
  card.classList.add(s.bg === 'green' ? 'nt-bg-green' : (s.bg === 'plain' ? 'nt-bg-plain' : 'nt-bg-dark'));

  // css vars adjust
  card.style.setProperty('--nt-name-fs', s.name_fs + 'px');
  card.style.setProperty('--nt-name-y',  s.name_y + 'px');
  card.style.setProperty('--nt-photo-s', s.photo_s + 'px');
  card.style.setProperty('--nt-photo-y', s.photo_y + 'px');

   // ✅ header vars
  card.style.setProperty('--nt-head-fs', s.head_fs + 'px');
  card.style.setProperty('--nt-head-y',  s.head_y + 'px');
  card.style.setProperty('--nt-sub-fs',  s.sub_fs + 'px');
  card.style.setProperty('--nt-sub-y',   s.sub_y + 'px');

  // peserta terpilih
  const it = NT.queue.find(x => x.nik === NT.selectedNik) || NT.queue[0] || { nik:'', nama:'', batch:'' };
  NT.selectedNik = it.nik || '';
  card.innerHTML = ntCardHtml({ settings:s, peserta:it, photoUrl: it.photoUrl });

  // info
  const info = $('#nt_info');
  if (info) info.textContent = `Preview: ${it.nama || '-'} (${it.nik || '-'})`;
}

function ntRenderQueue(){
  const box = $('#nt_queue');
  if (!box) return;

  if (!NT.queue.length){
    box.innerHTML = `<div class="small">Belum ada antrian.</div>`;
    ntUpdateQueueHeader();   // ✅
    ntUpdatePickInfo();      // ✅
    return;
  }

  box.innerHTML = NT.queue.map(x=>`
    <div class="nt-qitem" data-nik="${escapeHtml(x.nik)}" title="Klik untuk preview">
      <div>
        <b>${escapeHtml(x.nama)}</b>
        <div class="mini">${escapeHtml(x.nik)}${x.batch ? ' • '+escapeHtml(x.batch) : ''}</div>
      </div>
      <button class="btn danger" data-del="${escapeHtml(x.nik)}" type="button">Hapus</button>
    </div>
  `).join('');

  // click select
  box.querySelectorAll('.nt-qitem').forEach(el=>{
    el.addEventListener('click', (e)=>{
      const del = e.target?.getAttribute?.('data-del');
      if (del) return; // handled below
      NT.selectedNik = el.dataset.nik;
      ntRenderPreview();
    });
  });

  // delete
  box.querySelectorAll('button[data-del]').forEach(b=>{
    b.addEventListener('click', (e)=>{
      e.stopPropagation();
      const nik = b.dataset.del;
      NT.queue = NT.queue.filter(z=>z.nik !== nik);
      if (NT.selectedNik === nik) NT.selectedNik = (NT.queue[0]?.nik || '');
      ntRenderQueue();
      ntRenderPreview();
    });
  });
  ntUpdateQueueHeader();
  ntUpdatePickInfo();
}

/* =========================================================
   ✅ NAME TAG: LOCAL PICKED (disable tombol Tambah) + INFO REALTIME
   - Semua hanya localStorage (tidak mempengaruhi server)
   ========================================================= */

function ntLoadPickedLocal(){
  try{
    const raw = localStorage.getItem(NT.LS_PICK_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    NT.pickedSet = new Set((arr || []).map(x=>String(x)));
  }catch(e){
    NT.pickedSet = new Set();
  }
}

function ntSavePickedLocal(){
  try{
    localStorage.setItem(NT.LS_PICK_KEY, JSON.stringify([...NT.pickedSet]));
  }catch(e){}
}

function ntPickedCount(){
  return NT.pickedSet ? NT.pickedSet.size : 0;
}

function ntUpdatePickInfo(){
  const el = document.getElementById('nt_pick_info');
  if (!el) return;

  const pickedNiks = [...NT.pickedSet];
  if (!pickedNiks.length){
    el.innerHTML = `Dipilih (local): <b>0</b> • Antrian cetak: <b>${NT.queue.length}</b>`;
    return;
  }

  // tampilkan nama dari lastRows jika ada, fallback ke nik
  const nameOf = (nik)=>{
    const it = (NT.lastRows || []).find(r=>String(r.nik)===String(nik));
    return it?.nama || nik;
  };

  const preview = pickedNiks
    .slice(0, 12)
    .map(nik=>`<span class="chip" style="cursor:default;">${escapeHtml(nameOf(nik))}</span>`)
    .join(' ');

  const more = pickedNiks.length > 12 ? ` <span class="small">(+${pickedNiks.length-12} lagi)</span>` : '';

  el.innerHTML = `
    Dipilih (local): <b>${pickedNiks.length}</b> • Antrian cetak: <b>${NT.queue.length}</b><br/>
    ${preview}${more}
  `;
}

function ntUpdateQueueHeader(){
  // menambahkan info jumlah di area antrian (tanpa ubah struktur besar)
  const box = document.getElementById('nt_queue');
  if (!box) return;

  // kalau sudah ada header count, jangan dobel
  const wrapId = 'nt_queue_count';
  let c = document.getElementById(wrapId);
  if (!c){
    c = document.createElement('div');
    c.id = wrapId;
    c.className = 'small';
    c.style.marginBottom = '8px';
    // sisipkan sebelum list item (di dalam box)
    box.parentElement?.insertBefore(c, box);
  }
  c.innerHTML = `Jumlah nama dalam antrian cetak: <b>${NT.queue.length}</b>`;
}

function ntRefreshAddButtons(){
  // aktif/nonaktifkan tombol Tambah sesuai pickedSet (tanpa reload server)
  const tbody = document.querySelector('#nt_table tbody');
  if (!tbody) return;

  tbody.querySelectorAll('button[data-add]').forEach(btn=>{
    const nik = String(btn.dataset.add || '');
    const disabled = NT.pickedSet.has(nik);
    btn.disabled = disabled;
    btn.classList.toggle('ghost', disabled);
    btn.textContent = disabled ? 'Sudah ditambahkan' : 'Tambah';
  });
}

function ntRenderPesertaTable(rows){
  const table = document.getElementById('nt_table');
  const tbody = table ? table.querySelector('tbody') : null;
  if (!tbody){
    UI.setAdminResult('Elemen tabel peserta (#nt_table tbody) tidak ditemukan di HTML.', false);
    return;
  }

  NT.lastRows = rows || [];

  // render rows
  tbody.innerHTML = (rows || []).map(x=>{
    const nik = String(x.nik);
    const dis = NT.pickedSet.has(nik);
    return `
      <tr>
        <td>${escapeHtml(x.nik)}</td>
        <td>${escapeHtml(x.nama)}</td>
        <td>${escapeHtml(x.batch || '')}</td>
        <td>
          <button class="btn primary" data-add="${escapeHtml(x.nik)}" type="button" ${dis?'disabled':''}>
            ${dis?'Sudah ditambahkan':'Tambah'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // bind add actions
  tbody.querySelectorAll('button[data-add]').forEach(btn=>{
    btn.addEventListener('click', async()=>{
      const nik = String(btn.dataset.add || '');
      const it = (rows || []).find(z => String(z.nik) === nik);
      if (!it) return;

      // ✅ jika sudah picked local, stop (double safety)
      if (NT.pickedSet.has(nik)){
        UI.setAdminResult('Nama ini sudah ditambahkan (local). Gunakan Reset Pilihan jika ingin menambahkan ulang.', false);
        return;
      }

      // ✅ jika sudah ada di queue (double safety)
      if (NT.queue.some(z => String(z.nik) === nik)){
        UI.setAdminResult('Peserta sudah ada di antrian.', false);
        return;
      }

      // ✅ baca setting sekali
      const s = ntReadSettingsFromUI();

      // =========================================================
      // ✅ 1) Tambah ke antrian dulu (INSTAN) tanpa menunggu foto
      // =========================================================
      NT.queue.push({ nik: it.nik, nama: it.nama, batch: it.batch || '', photoUrl: '' });
      if (!NT.selectedNik) NT.selectedNik = it.nik;

      // ✅ set picked local + persist
      NT.pickedSet.add(nik);
      ntSavePickedLocal();

      // ✅ disable tombol langsung biar terasa cepat
      btn.disabled = true;
      btn.classList.add('ghost');
      btn.textContent = 'Sudah ditambahkan';

      // ✅ render minimal yang perlu (sekali)
      ntRenderQueue();
      ntRenderPreview();
      ntUpdateQueueHeader();
      ntUpdatePickInfo();

      UI.setAdminResult(`Ditambahkan ke antrian: ${it.nama}${s.type==='B' ? ' (foto diproses…)':''}`, true);

      // =========================================================
      // ✅ 2) Kalau template B, ambil foto BELAKANGAN (async)
      //     - tidak mengunci UI
      // =========================================================
      if (s.type === 'B'){
        idle(async ()=>{
          try{
            const p = await ntGetPhotoByNik(it.nik); // ini yg lama (GAS/Drive)
            if (p){
              ntUpdatePhotoInQueue(String(it.nik), p);
              // tidak wajib render queue ulang; preview saja cukup
              // jika Anda ingin memastikan kartu print sudah bawa foto:
              // (opsional) ntRenderQueue();
            }
          } catch(e){
            // kalau gagal foto, biarkan saja (nametag tetap bisa dicetak tanpa foto)
          }
        });
      }
    });
  });

  // info bawah tabel (tetap)
  ntUpdatePickInfo();
  ntRefreshAddButtons();
}

function ntUpdatePhotoInQueue(nik, dataUrl){
  nik = String(nik||'');
  const idx = NT.queue.findIndex(z => String(z.nik) === nik);
  if (idx < 0) return;

  NT.queue[idx].photoUrl = dataUrl || '';

  // refresh preview kalau yg sedang dipreview itu orangnya
  if (NT.selectedNik === nik){
    try{ ntRenderPreview(); }catch(e){}
  }
}

function idle(cb){
  // jalankan saat browser senggang supaya UI tetap ringan
  if (window.requestIdleCallback) return requestIdleCallback(()=>cb(), { timeout: 1200 });
  return setTimeout(cb, 0);
}

/* --- Ambil foto dari Drive via GAS (folder ID Anda) --- */
async function ntGetPhotoByNik(nik){
  nik = String(nik||'').trim();
  if (!nik) return '';

  if (NT.photoCache[nik]) return NT.photoCache[nik];

  // butuh login admin (karena akses drive / data peserta)
  if (!isAdminSessionValid()) return '';

  const r = await api('adminGetPhotoByNik', {
    admin_token: State.adminToken,
    nik
  });

  if (r.ok && r.dataUrl){
    NT.photoCache[nik] = r.dataUrl;
    return r.dataUrl;
  }
  return '';
}

/* --- Load peserta terfilter dari server --- */
async function ntLoadPeserta(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  // helper aman ambil value dari element yang mungkin tidak ada
  const val = (...ids) => {
    for (const id of ids){
      const el = document.getElementById(id);
      if (el && typeof el.value !== 'undefined') return String(el.value || '').trim();
    }
    return '';
  };

  // ✅ ambil dari UI (support jika id batch Anda ternyata berbeda)
  const training_type = val('nt_training_type');
  const group = val('nt_group', 'nt_batch');   // fallback kalau ternyata id-nya nt_batch
  const q = val('nt_q');

  if (!training_type || !group){
    UI.setAdminResult('Pilih Training Type dan Batch terlebih dahulu.', false);
    return;
  }

  const r = await api('adminPesertaList', {
    admin_token: State.adminToken,
    training_type,
    group,
    q,
    limit: 300
  });

  if (!r.ok) throw new Error(r.error || 'Gagal muat peserta');

  // ✅ pastikan tabel ada
  const table = document.getElementById('nt_table');
  const tbody = table ? table.querySelector('tbody') : null;
  if (!tbody){
    UI.setAdminResult('Elemen tabel peserta (#nt_table tbody) tidak ditemukan di HTML.', false);
    return;
  }

  const rows = r.items || [];
  ntRenderPesertaTable(rows);
    
  const info = document.getElementById('nt_info');
  if (info) info.textContent = `Peserta loaded: ${rows.length}`;
}

function ntBuildDummyCards(count){
  if (count <= 0) return '';
  return Array.from({ length: count }).map(() => `
    <div class="nt-card nt-dummy"></div>
  `).join('');
}

/* --- Print A4 via window.print (Save as PDF) --- */
function ntOpenPrintWindow(){
  const s = ntReadSettingsFromUI();
  if (!NT.queue.length){
    UI.setAdminResult('Antrian kosong. Tambahkan peserta dulu.', false);
    return;
  }

  const LAYOUT = (State.cfg && State.cfg.nametag_layouts) ? State.cfg.nametag_layouts : ntDefaultLayouts();

  const layKey = String(s.layout || '2up');
  const lay = LAYOUT[layKey] || LAYOUT['2up'] || { per:2, cols:1, pad:10, gap:8 };

  const perPage  = Number(lay.per || 2);
  const sheetPad = Number(lay.pad || 10);
  const gridGap  = Number(lay.gap || 8);
  const cols     = Number(lay.cols || 1);

  // ✅ grid A4
  const gridCss = `grid-template-columns: repeat(${cols}, 1fr); grid-auto-rows: 1fr; gap: ${gridGap}mm;`;

  // ✅ kartu isi penuh cell (rapat, tidak ada whitespace)
  const cardHeight = '100%';

  const cards = NT.queue.map(p=>{
    return `
      <div class="nt-card ${s.type==='B'?'nt-typeB':'nt-typeA'} ${s.bg==='green'?'nt-bg-green':(s.bg==='plain'?'nt-bg-plain':'nt-bg-dark')}"
        style="
          --nt-name-fs:${s.name_fs}px;
          --nt-name-y:${s.name_y}px;
          --nt-photo-s:${s.photo_s}px;
          --nt-photo-y:${s.photo_y}px;

          --nt-head-fs:${s.head_fs}px;
          --nt-head-y:${s.head_y}px;
          --nt-sub-fs:${s.sub_fs}px;
          --nt-sub-y:${s.sub_y}px;

          width: 100%;
          height: ${cardHeight};
          page-break-inside: avoid;
        ">
        ${ntCardHtml({ settings:s, peserta:p, photoUrl:p.photoUrl })}
      </div>
    `;
  });

  // paging
  let pages = [];
  for (let i = 0; i < cards.length; i += perPage){
    const slice = cards.slice(i, i + perPage);
    const remainder = slice.length % perPage;
    const dummyCount = remainder === 0 ? 0 : (perPage - remainder);

    const filledChunk =
      slice.join('') +
      ntBuildDummyCards(dummyCount);

    pages.push(`
      <div class="print-sheet"
        style="width:210mm;height:297mm;padding:${sheetPad}mm;box-sizing:border-box;">
        <div style="display:grid; ${gridCss} height:100%;">
          ${filledChunk}
        </div>
      </div>
    `);
  }

  const w = window.open('', '_blank');
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Name Tag Print</title>
  <style>
    @page { size: A4; margin: 0; }
    body { margin:0; font-family: Inter, Arial, sans-serif; background:#fff; }

    /* CSS Anda tetap sama di bawah ini */
    .nt-card{ border-radius:18px; border:2px solid rgba(0,0,0,.12); overflow:hidden; position:relative; background:#0b1220; }
    .nt-bg-dark{
      background:
        radial-gradient(circle at 20% 25%, rgba(99,102,241,.22), transparent 45%),
        radial-gradient(circle at 80% 20%, rgba(139,92,246,.20), transparent 45%),
        radial-gradient(circle at 40% 80%, rgba(6,182,212,.14), transparent 50%),
        #0b1220;
      color:#fff;
    }
    .nt-bg-green{
      background:
        radial-gradient(circle at 20% 20%, rgba(34,197,94,.18), transparent 48%),
        radial-gradient(circle at 80% 25%, rgba(16,185,129,.18), transparent 45%),
        radial-gradient(circle at 50% 80%, rgba(132,204,22,.12), transparent 55%),
        #062214;
      color:#fff;
    }
    .nt-bg-plain{ background:#111827; color:#fff; }

    .nt-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; background: rgba(255,255,255,.10); }
    .nt-logos{ display:flex; align-items:center; gap:10px; min-width: 70px; }
    .nt-logos img{ height: 34px; width:auto; border-radius:8px; background: rgba(255,255,255,.10); padding:4px; }
    .nt-headtxt{ flex:1; text-align:center; line-height:1.2; }
    .nt-event{ font-weight:900; font-size:15px; }
    .nt-sub{ font-weight:800; font-size:13px; opacity:.9; }

    .nt-name{
      position:absolute; left:22px; right:22px; top: 120px;
      transform: translateY(var(--nt-name-y));
      font-weight:900; font-size: var(--nt-name-fs);
      line-height:1.05; text-align:center;
      text-shadow: 0 10px 26px rgba(0,0,0,.45);
    }

    .nt-photo{
      position:absolute; left:50%; top:120px;
      transform: translate(-50%, calc(-50% + var(--nt-photo-y)));
      width: var(--nt-photo-s); height: var(--nt-photo-s);
      border-radius:999px; overflow:hidden;
      border: 4px solid rgba(255,255,255,.25);
      background: rgba(255,255,255,.10);
    }
    .nt-photo img{ width:100%; height:100%; object-fit:cover; }
    .nt-typeA .nt-photo{ display:none; }

    .nt-foot{
      position:absolute; left:0; right:0; bottom:0;
      padding: 10px 14px;
      background: rgba(0,0,0,.25);
      text-align:center;
      font-weight:800;
      font-size:12px;
      border-top: 1px solid rgba(255,255,255,.12);
    }
    
    .nt-dummy{
    visibility: hidden;       /* tidak terlihat */
    border: none !important;
    background: transparent !important;
  }

  </style>
</head>
<body>
  ${pages.join('')}
  <script>
    window.onload = () => setTimeout(()=>window.print(), 250);
  </script>
</body>
</html>
  `;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* --- Send event settings to server (optional log) --- */
async function ntSendSettingsToServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const s = ntReadSettingsFromUI();
  const r = await api('adminNameTagSaveEvent', { admin_token: State.adminToken, settings: s });
  if (!r.ok) throw new Error(r.error || 'Gagal kirim setting');
  return r;
}

function initNameTag(){
  // restore settings
  const s = ntLoadSettings();
  ntApplySettingsToUI(s);
  ntApplySliderBoundsFromCfg();

  ntLoadPickedLocal();       // ✅
  ntUpdatePickInfo();        // ✅

  // ✅ bind file pickers -> dataURL
  const logoFile = $('#nt_logo_file');
  const cologoFile = $('#nt_cologo_file');

  logoFile?.addEventListener('change', async()=>{
    const f = logoFile.files && logoFile.files[0];
    if (!f) return;
    const dataUrl = await fileToDataURL(f);
    $('#nt_logo').value = dataUrl;
    $('#nt_logo_info').textContent = `✅ Logo: ${f.name}`;
    ntRenderPreview();
  });

  cologoFile?.addEventListener('change', async()=>{
    const f = cologoFile.files && cologoFile.files[0];
    if (!f) return;
    const dataUrl = await fileToDataURL(f);
    $('#nt_cologo').value = dataUrl;
    $('#nt_cologo_info').textContent = `✅ Co-Logo: ${f.name}`;
    ntRenderPreview();
  });

  $('#btn-nt-logo-clear')?.addEventListener('click', ()=>{
    if (logoFile) logoFile.value = '';
    $('#nt_logo').value = '';
    $('#nt_logo_info').textContent = '-';
    ntRenderPreview();
  });

  $('#btn-nt-cologo-clear')?.addEventListener('click', ()=>{
    if (cologoFile) cologoFile.value = '';
    $('#nt_cologo').value = '';
    $('#nt_cologo_info').textContent = '-';
    ntRenderPreview();
  });

  // ✅ cascading filter NameTag: TrainingType -> Batch
  const ttEl = $('#nt_training_type');
  const grpEl = $('#nt_group');

  try{
    const meta = State._dashMeta || {};
    const trainingTypes = (meta.jenis_pelatihan || meta.training_types || []);
    fillSelect(ttEl, trainingTypes, 'Pilih Training Type…');

    const refreshNTGroups = ()=>{
      const tt = (ttEl?.value || '').trim();
      const groupsByType = meta.groups_by_training_type || {};
      const groups = tt ? (groupsByType[tt] || []) : (meta.groups || []);
      fillSelect(grpEl, groups, 'Pilih Batch…');

      // kalau sebelumnya tersimpan group yang tidak ada di TT baru, otomatis kosong
      const cur = (grpEl.value || '').trim();
      if (cur && !(groups || []).includes(cur)) grpEl.value = '';
    };

    ttEl?.addEventListener('change', ()=>{
      refreshNTGroups();
      ntRenderPreview();
    });

    grpEl?.addEventListener('change', ()=> ntRenderPreview());

    // initial
    refreshNTGroups();

    // restore saved tt/group if exist
    if (s.training_type && ttEl) ttEl.value = s.training_type;
    refreshNTGroups();
    if (s.group && grpEl) grpEl.value = s.group;

  } catch(e){}

  // listeners common
  const rerender = ()=> ntRenderPreview();

  ['nt_type','nt_bg','nt_event','nt_loc','nt_date','nt_layout'].forEach(id=>{
    $('#'+id)?.addEventListener('change', rerender);
    $('#'+id)?.addEventListener('input', rerender);
  });

  ['nt_name_fs','nt_name_y','nt_photo_s','nt_photo_y','nt_head_fs','nt_head_y','nt_sub_fs','nt_sub_y'].forEach(id=>{
  $('#'+id)?.addEventListener('input', rerender);
  });

  $('#btn-nt-save')?.addEventListener('click', ()=>{
    const s2 = ntReadSettingsFromUI();
    ntSaveSettingsToLS(s2);
    $('#nt_info').textContent = '✅ Setting tersimpan di perangkat.';
    UI.setAdminResult('Setting name tag tersimpan.', true);
    ntRenderPreview();
  });

  $('#btn-nt-send')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-nt-send'),
    async()=>{
      const r = await ntSendSettingsToServer();
      UI.setAdminResult('Setting name tag terkirim ke server.', true);
      $('#nt_info').textContent = '✅ Terkirim: ' + (r.message || 'OK');
    },
    { text:'Mengirim…', overlay:true, overlayText:'Mengirim setting name tag…' }
  ));

  $('#btn-nt-load')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-nt-load'),
    async()=> await ntLoadPeserta(),
    { text:'Memuat…', overlay:true, overlayText:'Memuat daftar peserta…' }
  ));

  $('#btn-nt-clear')?.addEventListener('click', ()=>{
      NT.queue = [];
      NT.selectedNik = '';
      ntRenderQueue();
      ntRenderPreview();

      // ✅ tombol tambah tetap disable (karena pickedSet tidak dihapus)
    ntUpdateQueueHeader();
    ntUpdatePickInfo();
    ntRefreshAddButtons();
    UI.setAdminResult('Antrian cetak dikosongkan. Status pilihan (local) tetap tersimpan.', true);
    });

    $('#btn-nt-resetlocal')?.addEventListener('click', ()=>{
    if (!confirm('Reset Pilihan akan mengaktifkan kembali tombol "Tambah" (local). Lanjutkan?')) return;

    NT.pickedSet = new Set();
    ntSavePickedLocal();

    // queue boleh tetap atau ikut kosong? requirement hanya reset pilihan.
    // Saya biarkan queue tetap ada; jika mau ikut kosongkan, tinggal set NT.queue=[]
    ntRefreshAddButtons();
    ntUpdatePickInfo();

    UI.setAdminResult('Reset Pilihan berhasil. Tombol "Tambah" aktif kembali (local).', true);
  });

  $('#btn-nt-print')?.addEventListener('click', ()=>{
    ntOpenPrintWindow();
  });

  // first render
  ntRenderQueue();
  ntRenderPreview();
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
    smartStatusUpdate(true);
  }
  mode.addEventListener('change', refresh);
  refresh();

  document.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{ $('#gate_reason').value = ch.dataset.reason; smartStatusUpdate(true);});
  });

    $('#btn-in').addEventListener('click', async()=>{
    State.gateDirection = 'IN';
    validateEnablePresensi();
    updateScanBadge();
    smartStatusUpdate(true);
    await openPesertaCameraModal(); // ✅ buka kamera full-screen
    UI.setResult('Mobilitas: MASUK. Pastikan wajah jelas lalu tekan Presensi.', true);
  });

  $('#btn-out').addEventListener('click', async()=>{
    State.gateDirection = 'OUT';
    validateEnablePresensi();
    updateScanBadge();
    smartStatusUpdate(true);
    await openPesertaCameraModal(); // ✅ buka kamera full-screen
    UI.setResult('Mobilitas: KELUAR. Pastikan wajah jelas lalu tekan Presensi.', true);
  });

  // gate reason berubah dari input/chip
  $('#gate_reason')?.addEventListener('input', ()=>{clearPresensiFail(); smartStatusUpdate(false);});
  $('#gate_reason')?.addEventListener('change', ()=>{clearPresensiFail(); smartStatusUpdate(false);});
}

function initTraining(){
    // ✅ load meta dari cache dulu, lalu dari server
  tmLoadFromLS();
  tmApplyToPesertaUI();
  tmLoadFromServer(false).catch(()=>{ /* silent */ });

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

    // ✅ status realtime saat user ubah pilihan training
  ['change','input'].forEach(ev=>{
    t.addEventListener(ev, ()=> smartStatusUpdate(true));
    a.addEventListener(ev, ()=> smartStatusUpdate(true));
    $('#material')?.addEventListener(ev, ()=> smartStatusUpdate(false));
  });

  toggleMaterial();
}

async function gfOpenGeofenceTabAuto(){
  // hanya admin
  if (!isAdminSessionValid()) return;

  // pastikan UI ada
  gfEnsureAdminTabPane();
  gfEnsureAdminUI();

  // auto pull dari server -> local -> render
  try{
    await gfPullFromServerToLocal();
    gfBindAdminUIOnce();      // bind tombol2 (Tambah/Hapus dst)
    gfRenderAdminTable();
    UI.setAdminResult('✅ Multi lokasi dimuat otomatis dari server.', true);
  }catch(e){
    if (handleAdminAuthError_(e)) return;
    // fallback ke local kalau server gagal
    gfLoadFromLS();
    gfBindAdminUIOnce();
    gfRenderAdminTable();
    UI.setAdminResult('⚠️ Gagal tarik dari server. Menampilkan data lokal.', false);
  }
}

function initAdminModal(){
  const modal = $('#admin-modal');
  $('#btn-admin-open').addEventListener('click', async ()=>{
    show(modal);
    // ✅ FORCE CREATE ADMIN TABS TERMASUK MULTI LOKASI
  const tabsContainer = document.querySelector('#admin-pane .tabs2');
  if (tabsContainer){
    // Cek apakah tab geofence sudah ada
    const existingTabs = Array.from(tabsContainer.querySelectorAll('.tab2'));
    const hasGeofenceTab = existingTabs.some(tab => tab.dataset.atab === 'geofence');
    
    if (!hasGeofenceTab){
      const btn = document.createElement('button');
      btn.className = 'tab2';
      btn.type = 'button';
      btn.dataset.atab = 'geofence';
      btn.textContent = 'Multi Lokasi';
      tabsContainer.appendChild(btn);
    }
  }
    try{ tmResetForm(); }catch(e){}
    
    if (isAdminSessionValid()){
      $('#admin-login-pane').classList.add('hidden');
      $('#admin-pane').classList.remove('hidden');
      $('#admin-session').textContent = `Login OK. Exp: ${new Date(State.adminExp).toLocaleString()}`;
      $('#btn-admin-logout').disabled = false;
      
      adminLoadSettings();
      
      // ✅ PASTIKAN MULTI LOKASI DIBUAT SAAT MODAL DIBUKA
      gfEnsureAdminTabPane(); // Buat tab
      gfEnsureAdminUI();      // Buat UI
      gfBindAdminUIOnce();    // Bind event listeners
      
      try{
        await gfPullFromServerToLocal();
        gfRenderAdminTable();
      }catch(e){
        gfLoadFromLS();
        gfRenderAdminTable();
        UI.setAdminResult('⚠️ Gagal tarik dari server. Menampilkan data lokal.', false);
      }
      
      adminLoadMateri();
      dashTodayDefaults();
      
      // ✅ Load meta untuk dropdown
      await initDashboardMeta();

    // ✅ initEnrollEnhance hanya sekali
    if (!State.enrollInited){
      initEnrollEnhance();
      State.enrollInited = true;
    } else {
      // refresh info saja
      try{ enrollUpdateInfo(); }catch(e){}
    }

    // ✅ initNameTag hanya sekali (hindari dobel listener)
    if (!State.nameTagInited){
      initNameTag();
      State.nameTagInited = true;
    } else {
      try{ ntRenderQueue(); ntRenderPreview(); }catch(e){}
    }

    // ✅ apapun kondisinya, pastikan pane sesuai tab aktif ditampilkan
    adminSwitchTab(document.querySelector('.tab2.active')?.dataset?.atab || 'enroll');

  } else {
    $('#admin-pane').classList.add('hidden');
    $('#admin-login-pane').classList.remove('hidden');
    $('#btn-admin-logout').disabled = true;
    $('#admin-session').textContent = '';
    adminSwitchTab('enroll');
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

  // admin tabs (ROBUST: support .active dan/atau .hidden)
  function adminSwitchTab(tab){
  tab = String(tab || '').trim().toLowerCase();
  if (!tab) tab = 'enroll';
  
  // 1) set active tab button
  document.querySelectorAll('.tab2').forEach(btn=>{
    const v = String(btn.dataset.atab || '').trim().toLowerCase();
    btn.classList.toggle('active', v === tab);
  });
  
  // 2) Pastikan semua pane ada
  const panes = Array.from(document.querySelectorAll('#admin-pane .apane'));
  
  // 3) CREATE MISSING PANES IF NEEDED
  if (tab === 'geofence' && !document.getElementById('apane-geofence')){
    const adminPane = document.getElementById('admin-pane');
    if (adminPane){
      const p = document.createElement('div');
      p.className = 'apane active'; // Langsung aktif
      p.id = 'apane-geofence';
      p.innerHTML = `
        <div id="gf-pane-host"></div>
        <div class="small" style="opacity:.75;margin-top:10px;">
          *List lokasi otomatis diambil dari server saat tab ini dibuka.
        </div>
      `;
      adminPane.appendChild(p);
      
      // Pastikan UI dibuat
      gfEnsureAdminUI();
      gfRenderAdminTable();
    }
  }
  
  // 4) Tampilkan/sembunyikan pane yang sesuai
  const targetId = 'apane-' + tab;
  const target = document.getElementById(targetId);
  
  const showPane = (el, on)=>{
    if (!el) return;
    el.classList.toggle('active', !!on);
    el.classList.toggle('hidden', !on);
    el.style.display = on ? '' : 'none';
  };
  
  if (!target){
    console.warn('[ADMIN TAB] Pane not found:', targetId);
    panes.forEach(p=> showPane(p, false));
    if (panes[0]) showPane(panes[0], true);
    return;
  }
  
  // Hide all, show target
  panes.forEach(p=> showPane(p, p === target));
  
  // 5) Auto-load data untuk tab tertentu
  if (tab === 'training'){
    const btn = document.getElementById('btn-tm-refresh');
    if (btn){
      Busy.wrap(btn, async()=> await adminTrainingMetaList(), { text:'Memuat…', overlay:false });
    }
  }
  
  if (tab === 'geofence'){
    // Load data geofence
    Busy.wrap(null, async()=> {
      try{
        await gfPullFromServerToLocal();
        gfRenderAdminTable();
        UI.setAdminResult('✅ Multi lokasi dimuat dari server.', true);
      }catch(e){
        gfLoadFromLS();
        gfRenderAdminTable();
        UI.setAdminResult('⚠️ Gagal tarik dari server. Menampilkan data lokal.', false);
      }
    }, { text:'Memuat…' });
  }
}

  // Event delegation untuk tab (support dynamic tabs)
  document.querySelector('#admin-pane .tabs2')?.addEventListener('click', (e)=>{
    const btn = e.target?.closest?.('.tab2');
    if (!btn) return;
    adminSwitchTab(btn.dataset.atab);
  });

  // Juga bind secara manual sebagai fallback
  setTimeout(() => {
    document.querySelectorAll('.tab2').forEach(btn=>{
      if (!btn.hasAttribute('data-bound')) {
        btn.addEventListener('click', ()=>{
          adminSwitchTab(btn.dataset.atab);
        });
        btn.setAttribute('data-bound', 'true');
      }
    });
  }, 500);

  // bind clicks
  document.querySelectorAll('.tab2').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      adminSwitchTab(btn.dataset.atab);
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

    // ✅ TRAINING META CRUD
      $('#btn-tm-refresh')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-tm-refresh'),
        async()=> await adminTrainingMetaList(),
        { text:'Refresh…', overlay:true, overlayText:'Memuat master training…' }
      ));

      $('#btn-tm-save')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-tm-save'),
        async()=> await adminTrainingMetaSave(),
        { text:'Menyimpan…', overlay:true, overlayText:'Menyimpan master training…' }
      ));

      $('#btn-tm-reset')?.addEventListener('click', ()=> Busy.wrap(
        $('#btn-tm-reset'),
        async()=>{ tmResetForm(); $('#tm_info').textContent='-'; },
        { text:'Reset…' }
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
        setPresensiFail('Mode Mobilitas Peserta: pilih dulu Masuk atau Keluar agar tombol Presensi aktif');
        UI.setResult(State.ui.lastFailMessage, false);
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
  State.ui.pcamOpen = true;

  // ✅ bersihkan hasil modal kamera (posisinya sudah tepat)
  const rc = document.getElementById('result-cam');
  if (rc) rc.innerHTML = '';
  try{ camOutcomeHide(); }catch(e){}

  // title dinamis
  const mode = ($('#mode')?.value || 'training');
  const titleEl = $('#pcam-title');
  if (titleEl){
    if (mode === 'training'){
      titleEl.textContent = 'Kamera Presensi - Kegiatan Training';
    } else {
      const dir =
        (State.gateDirection === 'IN')  ? 'MASUK'  :
        (State.gateDirection === 'OUT') ? 'KELUAR' : '';
      titleEl.textContent = dir
        ? `Kamera Presensi - Mobilitas Peserta (${dir})`
        : 'Kamera Presensi - Mobilitas Peserta';
    }
  }

  // ✅ 1) izin lokasi
  try{
    if (State.locError || !isFinite(State.loc.distance_m)){
      await checkLocation({ force:false, silent:false, maxAgeMs:45000 });
    }
  }catch(e){
    // tampilkan di modal kamera (bukan panel status utama), jika Anda punya elemen result-cam
    if (rc) rc.innerHTML = `<div class="small">❌ Aktifkan izin lokasi agar Presensi bisa digunakan.</div>`;
    updateScanBadge();
    validateEnablePresensi();
    return; // 🔥 jika lokasi wajib
  }

  // ✅ 2) Start / restore camera stream dulu
  try{
    await switchCamera('peserta', State.cam.pesertaFacing);
  } catch(e){
    if (rc) rc.innerHTML = `<div class="small">❌ ${String(e?.message || e)}</div>`;
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

  State.ui.pcamOpen = false;
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

  gfLoadFromLS();
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
  updateLocPill();
  try{
    await checkLocation({ force:false, silent:true, maxAgeMs:45000 });
    updatePresensiReadyMessage();
  } catch(e){
    // silent:true biasanya tidak throw
  }

  // Kamera sekarang dibuka saat modal dibuka (lebih hemat & full screen)
  // await switchCamera('peserta', State.cam.pesertaFacing);
  // await switchCamera('admin', State.cam.adminFacing);
  updateLocPill();
  validateEnablePresensi();
  smartStatusUpdate(true);

  // warm up models
  try{ await loadModels(); } catch(e){ /* will retry on demand */ }
}

main();
