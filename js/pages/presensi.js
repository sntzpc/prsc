// SECTION: Presensi Flow (Peserta) + Auto Trigger
// Behavior:
// - Saat modal kamera terbuka: tombol presensi tetap bisa diklik.
// - Jika 3 detik tidak diklik: auto jalankan doPresensi().
// - Aman dari double trigger (manual & auto).
// Depends: base.js ($, State, UI), busy.js (runExclusive), location/geofence, face, status, camera.

// SECTION: Auto Presensi Config
const AUTO_PRESENSI_DELAY_MS = 2000;
const PRESENSI_FAIL_COUNT_KEY = 'presensi_fail_face_count';
const PRESENSI_FAIL_CTX_KEY = 'presensi_fail_face_ctx';
const PRESENSI_RECON_SUBMITTED_KEY = 'presensi_recon_submitted_today';
let reconcileSubmitInFlight = false;

function getPresensiFailCount(){
  return Number(localStorage.getItem(PRESENSI_FAIL_COUNT_KEY) || 0) || 0;
}
function setPresensiFailCount(v){
  localStorage.setItem(PRESENSI_FAIL_COUNT_KEY, String(Math.max(0, Number(v)||0)));
}
function clearPresensiFailCount(){
  localStorage.removeItem(PRESENSI_FAIL_COUNT_KEY);
  localStorage.removeItem(PRESENSI_FAIL_CTX_KEY);
}
function clearPresensiReconSubmitted(){
  localStorage.removeItem(PRESENSI_RECON_SUBMITTED_KEY);
}
function resetPresensiFailureTracking(){
  clearPresensiFailCount();
  clearPresensiReconSubmitted();
}
function todayKeyLocal_(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function getReconSubmittedToday(){
  const raw = localStorage.getItem(PRESENSI_RECON_SUBMITTED_KEY) || '';
  return raw === todayKeyLocal_();
}
function markReconSubmittedToday(){
  localStorage.setItem(PRESENSI_RECON_SUBMITTED_KEY, todayKeyLocal_());
}
function isRecognitionFailureStatus(st){
  const s = String(st || '').toUpperCase();
  return ['FACE_NOT_MATCH','FACE_AMBIGUOUS','LIVENESS_FAIL','LIVENESS_MODE_MISMATCH'].includes(s);
}
function openReconcileModal(ctx = {}){
  const modal = $('#reconcile-modal');
  if (!modal) return;
  show(modal);
  const info = $('#reconcile-info');
  if (info){
    const cnt = getPresensiFailCount();
    info.innerHTML = `Percobaan gagal terdeteksi <b>${cnt} kali</b>. Silakan ajukan rekonsil dengan NIK yang valid.`;
  }
  try{ localStorage.setItem(PRESENSI_FAIL_CTX_KEY, JSON.stringify(ctx || {})); }catch(e){}
  if ($('#reconcile-result')) $('#reconcile-result').innerHTML = '';
}
function closeReconcileModal(){
  const modal = $('#reconcile-modal');
  if (modal) hide(modal);
}
async function submitReconcileRequest(){
  const nik = ($('#reconcile-nik')?.value || '').trim();
  const request_note = ($('#reconcile-note')?.value || '').trim();
  const result = $('#reconcile-result');
  const btn = $('#btn-reconcile-submit');

  if (reconcileSubmitInFlight){
    if (result) result.innerHTML = 'Pengajuan rekonsil sedang diproses. Mohon tunggu…';
    return;
  }

  if (getReconSubmittedToday()){
    if (result) result.innerHTML = 'Permohonan rekonsil untuk perangkat ini hari ini sudah pernah diajukan.';
    return;
  }

  if (!nik){
    if (result) result.innerHTML = 'NIK wajib diisi.';
    return;
  }

  let ctx = {};
  try{ ctx = JSON.parse(localStorage.getItem(PRESENSI_FAIL_CTX_KEY) || '{}') || {}; }catch(e){}
  const payload = {
    nik,
    request_note,
    fail_count: getPresensiFailCount(),
    last_status: ctx.last_status || '',
    mode: ctx.mode || ($('#mode')?.value || 'training'),
    training_type: ctx.training_type || ($('#training_type')?.value || ''),
    activity: ctx.activity || ($('#activity')?.value || ''),
    material: ctx.material || ($('#material')?.value || ''),
    gate_reason: ctx.gate_reason || '',
    gate_direction: ctx.gate_direction || '',
    device_id: State.deviceId || '',
    lat: State.loc?.lat,
    lng: State.loc?.lng,
    accuracy_m: State.loc?.accuracy_m
  };

  const prevText = btn?.textContent || 'Ajukan Rekonsil';
  reconcileSubmitInFlight = true;
  if (btn){
    btn.disabled = true;
    btn.textContent = 'Mengajukan…';
  }

  try{
    const r = await api('submitReconcile', payload);
    if (!r.ok) throw new Error(r.error || 'Pengajuan rekonsil gagal');
    if (result) result.innerHTML = `✅ ${escapeHtml(r.message || 'Permohonan berhasil diajukan.')}<br><b>${escapeHtml(r.nama || '')}</b>`;
    markReconSubmittedToday();
    resetPresensiFailureTracking();
    setTimeout(()=> closeReconcileModal(), 900);
  }catch(err){
    if (result) result.innerHTML = `❌ ${escapeHtml(String(err.message || err))}`;
  }finally{
    reconcileSubmitInFlight = false;
    if (btn){
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }
}
function trackRecognitionFailure(ctx = {}){
  const next = getPresensiFailCount() + 1;
  setPresensiFailCount(next);
  try{ localStorage.setItem(PRESENSI_FAIL_CTX_KEY, JSON.stringify(ctx || {})); }catch(e){}
  if (next >= 5){
    openReconcileModal(ctx);
  }
}
function bindReconcileUi(){
  $('#btn-reconcile-close')?.addEventListener('click', closeReconcileModal);
  $('#reconcile-modal')?.addEventListener('click', (e)=>{ if (e.target?.id === 'reconcile-modal') closeReconcileModal(); });
  $('#btn-reconcile-submit')?.addEventListener('click', ()=> submitReconcileRequest());
}


// internal state
let autoPresensiTimer = null;
let autoPresensiArmed = false;       // kamera sedang terbuka & timer aktif
let autoPresensiTriggered = false;   // sudah trigger (manual/auto) pada sesi kamera ini

// SECTION: Presensi Main Flow (PASTIKAN INI ADA DI FILE INI)
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
        trackRecognitionFailure({ last_status:'LIVENESS_FAIL', mode: payload.mode, training_type: payload.training_type, activity: payload.activity, material: payload.material, gate_reason: payload.gate_reason, gate_direction: payload.gate_direction });
        presensiFailCam('Liveness gagal. Coba lagi (cahaya cukup, wajah penuh di kamera).');
        return;
      }
      payload.liveness = live;

      UI.setResult('Memindai wajah (multi-shot)…', true);

      const descAvg = await captureMultiShotAvg($('#video'), 3, 2500);
      if (!descAvg){
        trackRecognitionFailure({ last_status:'LOCAL_FACE_FAIL', mode: payload.mode, training_type: payload.training_type, activity: payload.activity, material: payload.material, gate_reason: payload.gate_reason, gate_direction: payload.gate_direction });
        presensiFailCam('Wajah tidak stabil terdeteksi. Coba lagi.');
        return;
      }
      payload.descriptor_avg = descAvg;

      const r = await api('verifyAndLog', payload);

      if (r.ok){
        clearPresensiFail();
        resetPresensiFailureTracking();

        UI.setResult(
          `Presensi diterima: <b>${escapeHtml(r.nama)}</b> (NIK: ${escapeHtml(r.nik)})<br/>
          Jarak center: ${Math.round(r.distance_m)} m<br/>
          Status: <b>${escapeHtml(r.status || '')}</b>`,
          true
        );

        const successHtml = (String(r.status || '') === 'AUTO_RECONCILE_GAGAL_CATAT')
          ? `Presensi tervalidasi<br/><b>${escapeHtml(r.nama)}</b><br/><span class="small">Gagal catat ke attendance. Sistem otomatis mengajukan rekonsil${r.request_id ? ' #' + escapeHtml(r.request_id) : ''}.</span>`
          : `Presensi diterima<br/><b>${escapeHtml(r.nama)}</b><br/><span class="small">Modal akan menutup otomatis…</span>`;

        camOutcomeShow(true,
          successHtml,
          { delayOkMs: 2000, closeOnOk: true }
        );

      } else {
        if (isRecognitionFailureStatus(r.status)){
          trackRecognitionFailure({ last_status:r.status, mode: payload.mode, training_type: payload.training_type, activity: payload.activity, material: payload.material, gate_reason: payload.gate_reason, gate_direction: payload.gate_direction });
        }
        if (String(r.status || '').toUpperCase() === 'DUPLICATE_ATTEMPT'){
          presensiFailCam('Presensi duplikat terdeteksi.<br/>Jika barusan sudah presensi, tidak perlu ulang. (Anti-Duplicate Aktif)');
          return;
        }
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

// SECTION: Auto Presensi Helpers
function getCameraModalEl(){
  // sesuaikan bila ID modal Anda berbeda
  return $('#camera-modal') || $('#cam-modal') || $('#modal-camera') || $('#pcam-modal');
}

function isModalVisible(el){
  if (!el) return false;
  const hidden = el.classList.contains('hidden') || el.style.display === 'none';
  return !hidden;
}

function clearAutoPresensiTimer(){
  if (autoPresensiTimer){
    clearTimeout(autoPresensiTimer);
    autoPresensiTimer = null;
  }
}

async function waitVideoReady(videoEl, timeoutMs = 2500){
  const v = videoEl || $('#video');
  if (!v) return false;

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    if (v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0) return true;
    await new Promise(r => setTimeout(r, 80));
  }
  return false;
}

function armAutoPresensi(){
  autoPresensiArmed = true;
  autoPresensiTriggered = false;

  clearAutoPresensiTimer();

  // tombol presensi tetap bisa manual
  const btn = $('#btn-presensi');
  if (btn){
    btn.disabled = false;
    btn.classList.remove('disabled');
  }

  autoPresensiTimer = setTimeout(async () => {
    const modal = getCameraModalEl();
    if (!autoPresensiArmed || !isModalVisible(modal)) return;
    if (autoPresensiTriggered) return;

    autoPresensiTriggered = true;

    // tunggu video siap agar scan tidak gagal karena stream belum ready
    await waitVideoReady($('#video'), 3000);

    try{
      await doPresensi();
    }catch(e){
      console.warn('[auto-presensi] error:', e);
    }
  }, AUTO_PRESENSI_DELAY_MS);
}

function disarmAutoPresensi(){
  autoPresensiArmed = false;
  autoPresensiTriggered = false;
  clearAutoPresensiTimer();
}

function bindPresensiButtonForAutoOnce(){
  const btn = $('#btn-presensi');
  if (!btn) return;
  if (btn.dataset.autoBound === '1') return;
  btn.dataset.autoBound = '1';

  // capture=true supaya dieksekusi lebih dulu daripada handler click lain
  btn.addEventListener('click', () => {
    if (autoPresensiArmed){
      autoPresensiTriggered = true; // manual click = kunci auto
      clearAutoPresensiTimer();
    }
  }, true);
}

function initAutoPresensiOnCameraModal(){
  const modal = getCameraModalEl();
  if (!modal) {
    console.warn('[auto-presensi] modal kamera tidak ditemukan. Cek ID modal.');
    return;
  }

  bindPresensiButtonForAutoOnce();

  const obs = new MutationObserver(() => {
    const visible = isModalVisible(modal);
    if (visible) armAutoPresensi();
    else disarmAutoPresensi();
  });

  obs.observe(modal, { attributes:true, attributeFilter:['class','style'] });

  // kondisi awal
  if (isModalVisible(modal)) armAutoPresensi();
}

// SECTION: Export Globals (dibutuhkan jika app.js memanggil doPresensi())
(function exposePresensiGlobals(){
  window.Presensi = window.Presensi || {};
  window.Presensi.doPresensi = doPresensi;
  window.doPresensi = doPresensi; // backward compat
})();

// SECTION: Init Auto Presensi Hook
window.addEventListener('DOMContentLoaded', () => {
  initAutoPresensiOnCameraModal();
  bindReconcileUi();
});
