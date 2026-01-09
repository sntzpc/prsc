// SECTION: Presensi Flow (Peserta)
// Purpose : End-to-end presensi: check location -> open camera -> face match -> send to server -> UI feedback.
// Depends : core/base.js, core/api.js, core/location_base.js, core/face.js, core/status.js, pages/camera.js.
// Provides: doPresensi(), presensiHandlers(), validateBeforePresensi().

/* =========================
   PRESENSI FLOW (peserta)
   1) checkLocation
   2) liveness (blink/turn)
   3) multi-shot avg (3)
   4) send verifyAndLog (device_id included)
   ========================= */


/* ============================================
   SECTION: Presensi Idle Auto Enable (Button)
   Tujuan:
   - Tombol presensi otomatis aktif jika 3 detik tidak ada klik.
   - Saat klik presensi / ada aktivitas presensi: tombol disable, timer reset.
   - Selesai presensi (sukses/gagal): timer jalan lagi agar tombol aktif kembali.
   ============================================ */

const PRESENSI_BTN_SEL = '#btn-presensi';
const PRESENSI_IDLE_MS = 3000; // 3 detik
let presensiIdleTimer = null;

function getPresensiBtn(){
  return $(PRESENSI_BTN_SEL);
}

function setPresensiButtonEnabled(enabled){
  const btn = getPresensiBtn();
  if (!btn) return;

  btn.disabled = !enabled;
  btn.classList.toggle('disabled', !enabled);

  // opsional: beri tooltip kecil
  if (!enabled) btn.setAttribute('data-busy', '1');
  else btn.removeAttribute('data-busy');
}

/** Mulai ulang timer idle: disable dulu, lalu enable setelah idle */
function resetPresensiIdleTimer(){
  if (presensiIdleTimer){
    clearTimeout(presensiIdleTimer);
    presensiIdleTimer = null;
  }

  // setiap ada aktivitas, disable dulu
  setPresensiButtonEnabled(false);

  presensiIdleTimer = setTimeout(() => {
    setPresensiButtonEnabled(true);
  }, PRESENSI_IDLE_MS);
}

/** Hentikan timer idle (misalnya saat modal kamera dibuka lama) */
function stopPresensiIdleTimer(){
  if (presensiIdleTimer){
    clearTimeout(presensiIdleTimer);
    presensiIdleTimer = null;
  }
}

/** Panggil ini sekali saat halaman presensi siap dipakai */
function presensiIdleInit(){
  // Saat pertama kali masuk pane presensi: tombol akan aktif setelah 3 detik
  resetPresensiIdleTimer();
}


/* ============================================
   SECTION: Presensi Main Flow
   ============================================ */

async function doPresensi(){
  // ✅ Setiap kali user memulai presensi, reset timer (tombol akan disable, lalu aktif lagi setelah idle)
  resetPresensiIdleTimer();

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

      // ✅ Setelah proses presensi selesai (sukses/gagal), jadwalkan tombol aktif lagi setelah idle
      resetPresensiIdleTimer();
    }
  });
}


/* ============================================
   SECTION: Presensi Handlers (UI events)
   Catatan: Pastikan Anda memanggil presensiHandlers() saat init/pane presensi siap.
   ============================================ */

function presensiHandlers(){
  const btn = getPresensiBtn();
  if (!btn) return;

  // hindari dobel listener jika init terpanggil ulang
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  // saat aplikasi siap: tombol akan aktif otomatis setelah 3 detik
  presensiIdleInit();

  btn.addEventListener('click', async ()=>{
    // ✅ klik dianggap aktivitas: disable + reset timer langsung
    resetPresensiIdleTimer();
    await doPresensi();
  });

  // Opsional (kalau Anda mau): setiap user klik area mode/training/activity,
  // timer direset supaya tombol tidak langsung aktif saat user masih mengubah pilihan.
  const watchIds = ['#mode','#training_type','#activity','#material','#gate_reason'];
  watchIds.forEach(sel=>{
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', ()=> resetPresensiIdleTimer());
  });
}
