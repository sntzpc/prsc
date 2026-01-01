const $ = (s, r=document) => r.querySelector(s);

const UI = {
  setResult(msg, ok=true){
    $('#result').innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'BERHASIL':'GAGAL'}</div><div class="small">${msg}</div>`;
  },
  setAdminResult(msg, ok=true){
    $('#admin-result').innerHTML =
      `<div style="font-weight:900;margin-bottom:6px;">${ok?'✅':'❌'} ${ok?'OK':'ERROR'}</div><div class="small">${msg}</div>`;
  }
};

const State = {
  cfg: null,
  loc: { lat:null, lng:null, accuracy_m:null, distance_m:null, inFence:false },
  lastTrainingType: localStorage.getItem('lastTrainingType') || '',
  lastActivity: localStorage.getItem('lastActivity') || '',
  gateDirection: null,
  modelsReady: false,
  deviceId: null,

  adminToken: localStorage.getItem('admin_token') || '',
  adminExp: Number(localStorage.getItem('admin_exp') || 0)
};

// ✅ Ganti dengan URL Deploy Web App Anda (exec)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbx4x0X3e8S4SUHa5YPoPRvoZJRvSxOh_UOcEfWciPQNls9Wgzwth0G3vKqssqX1RXVi/exec';

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

async function runLiveness(videoEl, durationMs=3500){
  if (!State.modelsReady) await loadModels();

  const challenge = (Math.random() < 0.5) ? 'blink' : (Math.random() < 0.5 ? 'turn_left' : 'turn_right');
  UI.setResult(`Liveness: ${challenge === 'blink' ? 'KEDIPKAN mata' : (challenge === 'turn_left' ? 'Putar kepala KIRI' : 'Putar kepala KANAN')}…`, true);

  const start = Date.now();
  let blinked = false;
  let earLowSeen = false;

  let turned = false;

  // threshold sederhana (tuning)
  const EAR_LOW = 0.18;
  const EAR_HIGH = 0.23;
  const TURN_THRESH = 0.18; // ~18% dari jarak mata

  while (Date.now() - start < durationMs){
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
      return { ok:true, type:'blink', info:{ ear } };
    }
    if (challenge !== 'blink' && turned) {
      return { ok:true, type:'turn', info:{ dir: challenge, score } };
    }

    await sleep(90);
  }

  return { ok:false, type:'timeout', info:{ challenge } };
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
  if (!isFinite(L.distance_m)){
    pill.textContent = 'Belum cek lokasi';
    pill.style.borderStyle = 'dashed';
    return;
  }
  pill.textContent = L.inFence ? `Di area (${Math.round(L.distance_m)} m)` : `Di luar area (${Math.round(L.distance_m)} m)`;
  pill.style.borderStyle = 'solid';
}

function getLocation(){
  return new Promise((resolve, reject)=>{
    if (!navigator.geolocation) return reject(new Error('Geolocation tidak didukung'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy:true, timeout:15000, maximumAge:0
    });
  });
}

async function checkLocation(){
  await loadConfig(true);
  const pos = await getLocation();
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = pos.coords.accuracy || 0;

  const c = State.cfg.geofence.center;
  const d = haversineM(c.lat, c.lng, lat, lng);
  const inFence = d <= State.cfg.geofence.radius_m;

  State.loc = { lat, lng, accuracy_m:acc, distance_m:d, inFence };
  updateLocPill();
  validateEnablePresensi();
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
async function startCamera(videoEl){
  const stream = await navigator.mediaDevices.getUserMedia({
    video:{ facingMode:'user', width:{ideal:1280}, height:{ideal:720} },
    audio:false
  });
  videoEl.srcObject = stream;
  await new Promise(r=> videoEl.onloadedmetadata=r);
  return stream;
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
  try{
    await checkLocation();
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
         ${r.device_bound ? '✅ Device berhasil diikat (binding) pertama kali.' : ''}`,
        true
      );
    } else {
      UI.setResult(`${escapeHtml(r.error || 'Gagal')}<br/>Status: ${escapeHtml(r.status || '-')}`, false);
    }
  } catch(err){
    UI.setResult(String(err?.message || err), false);
  } finally {
    State.gateDirection = null;
  }
}

/* =========================
   ENROLL FLOW (admin)
   - multi-shot 5 avg
   - photo saved
   ========================= */
async function doEnroll(){
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

    // Liveness optional untuk enroll (boleh aktifkan kalau mau)
    // const live = await runLiveness($('#a_video'));
    // if (!live.ok){ UI.setAdminResult('Liveness enroll gagal. Coba lagi.', false); return; }

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
  $('#admin-session').textContent = 'Logout.';
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

    const r = await api('adminUpdateSettings', {
      admin_token: State.adminToken,
      geofence_lat, geofence_lng, geofence_radius_m,
      face_threshold
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
    if (v === 'training'){ trainingBox.classList.remove('hidden'); gateBox.classList.add('hidden'); }
    else { gateBox.classList.remove('hidden'); trainingBox.classList.add('hidden'); }
    validateEnablePresensi();
  }
  mode.addEventListener('change', refresh);
  refresh();

  document.querySelectorAll('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{ $('#gate_reason').value = ch.dataset.reason; validateEnablePresensi(); });
  });

  $('#btn-in').addEventListener('click', async()=>{ State.gateDirection='IN'; await doPresensi(); });
  $('#btn-out').addEventListener('click', async()=>{ State.gateDirection='OUT'; await doPresensi(); });
}

function initTraining(){
  const t = $('#training_type');
  const a = $('#activity');

  if (State.lastTrainingType) t.value = State.lastTrainingType;
  if (State.lastActivity) a.value = State.lastActivity;

  t.addEventListener('change', ()=>{
    localStorage.setItem('lastTrainingType', t.value||'');
    validateEnablePresensi();
  });

  a.addEventListener('change', ()=>{
    localStorage.setItem('lastActivity', a.value||'');
    toggleMaterial();
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
    } else {
      $('#admin-pane').classList.add('hidden');
      $('#admin-login-pane').classList.remove('hidden');
      $('#btn-admin-logout').disabled = true;
      $('#admin-session').textContent = '';
    }
  });
  $('#btn-admin-close').addEventListener('click', ()=> hide(modal));
  modal.addEventListener('click', (e)=>{ if (e.target === modal) hide(modal); });

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
  $('#btn-enroll').addEventListener('click', doEnroll);
  $('#btn-rekap').addEventListener('click', adminRekap);
  $('#btn-logs').addEventListener('click', adminLogs);
  $('#btn-export').addEventListener('click', adminExportCsv);

  // NEW: settings
  $('#btn-save-settings').addEventListener('click', adminSaveSettings);
  $('#btn-reload-settings').addEventListener('click', adminLoadSettings);
  $('#btn-change-pin').addEventListener('click', adminChangePin);

  // NEW: materi CRUD
  $('#btn-m-refresh').addEventListener('click', adminLoadMateri);
  $('#btn-m-save').addEventListener('click', adminSaveMateri);
  $('#btn-m-reset').addEventListener('click', ()=>{ resetMateriForm(); $('#materi-info').textContent='-'; });
}

async function main(){
  State.deviceId = getOrCreateDeviceId();
  $('#device-info').innerHTML = `Device ID: <b>${escapeHtml(State.deviceId)}</b>`;

  initMode();
  initTraining();
  initAdminModal();

  $('#btn-checkloc').addEventListener('click', async()=>{
    try{ await checkLocation(); UI.setResult('Lokasi berhasil dicek.', true); }
    catch(e){ UI.setResult(e.message || String(e), false); }
  });
  $('#btn-presensi').addEventListener('click', doPresensi);

  // camera peserta + admin
  await startCamera($('#video'));
  await startCamera($('#a_video'));

  await loadConfig();
  updateLocPill();
  validateEnablePresensi();

  // warm up models
  try{ await loadModels(); } catch(e){ /* will retry on demand */ }

  UI.setResult('Siap. Cek lokasi dulu sebelum presensi.', true);
}

main();
