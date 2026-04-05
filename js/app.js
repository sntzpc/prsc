// SECTION: App Entry Point
// Purpose : Bootstraps the app (deviceId, init mode/training, init admin modal, init camera modals).
// Depends : All core + page modules loaded before this file (see index.html script order).
// Provides: main() and window-level event wiring.

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
  const adminPane = $('#admin-pane');
  const loginPane = $('#admin-login-pane');
  const tabsWrap  = document.querySelector('#admin-pane .tabs2');

  // ---- OPEN/CLOSE ----
  $('#btn-admin-open')?.addEventListener('click', async ()=>{
    show(modal);

    // Reset form yang terkait (jaga-jaga)
    try{ tmResetForm(); }catch(e){}

    // Pastikan tab + pane Multi Lokasi tersedia (dibuat oleh geofence_admin.js)
    try{ gfEnsureAdminTabPane(); }catch(e){}

    if (isAdminSessionValid()){
      loginPane?.classList.add('hidden');
      adminPane?.classList.remove('hidden');
      $('#admin-session').textContent = `Login OK. Exp: ${new Date(State.adminExp).toLocaleString()}`;
      $('#btn-admin-logout').disabled = false;

      // muat modul-modul admin biasa
      try{ adminLoadSettings(); }catch(e){}
      try{ adminLoadMateri(); }catch(e){}
      try{ dashTodayDefaults(); }catch(e){}
      try{ await initDashboardMeta(); }catch(e){}
      try{ await adminLoadReconcile(); }catch(e){}

      // init fitur heavy hanya sekali
      if (!State.enrollInited){
        try{ initEnrollEnhance(); }catch(e){}
        State.enrollInited = true;
      } else {
        try{ enrollUpdateInfo(); }catch(e){}
      }

      if (!State.nameTagInited){
        try{ initNameTag(); }catch(e){}
        State.nameTagInited = true;
      } else {
        try{ ntRenderQueue(); ntRenderPreview(); }catch(e){}
      }

      // Pastikan UI geofence ter-mount (listener tombol) tapi data akan ditarik saat tab dibuka
      try{ gfMountAdminGeofence(); }catch(e){}

      // tampilkan pane sesuai tab aktif (default enroll)
      adminSwitchTab(document.querySelector('#admin-pane .tab2.active')?.dataset?.atab || 'enroll');
    } else {
      adminPane?.classList.add('hidden');
      loginPane?.classList.remove('hidden');
      $('#btn-admin-logout').disabled = true;
      $('#admin-session').textContent = '';
      adminSwitchTab('enroll');
    }
  });

  $('#btn-admin-close')?.addEventListener('click', ()=> hide(modal));
  modal?.addEventListener('click', (e)=>{ if (e.target === modal) hide(modal); });

  // camera toggle admin (enroll)
  $('#btn-a-cam-rotate')?.addEventListener('click', ()=> toggleCamera('admin'));

  // ---- AUTH ----
  $('#btn-admin-login')?.addEventListener('click', adminLogin);
  $('#btn-admin-logout')?.addEventListener('click', adminLogout);

  // ---- TABS ----
  function adminSwitchTab(tab){
    tab = String(tab || '').trim().toLowerCase() || 'enroll';

    // set active button (scope: admin pane)
    document.querySelectorAll('#admin-pane .tab2').forEach(btn=>{
      const v = String(btn.dataset.atab || '').trim().toLowerCase();
      btn.classList.toggle('active', v === tab);
    });

    // ensure pane exists for geofence
    if (tab === 'geofence' && !document.getElementById('apane-geofence')){
      try{ gfEnsureAdminTabPane(); }catch(e){}
      try{ gfEnsureAdminUI(); }catch(e){}
    }

    // hide/show panes (re-query AFTER ensure)
    const panes = Array.from(document.querySelectorAll('#admin-pane .apane'));
    const target = document.getElementById('apane-' + tab);

    const showPane = (el, on)=>{
      if (!el) return;
      el.classList.toggle('active', !!on);
      el.classList.toggle('hidden', !on);
      el.style.display = on ? '' : 'none';
    };

    panes.forEach(p=> showPane(p, p === target));
    if (!target && panes[0]) showPane(panes[0], true);

    // per-tab auto-load
    if (tab === 'training'){
      const btn = document.getElementById('btn-tm-refresh');
      if (btn){
        Busy.wrap(btn, async()=> await adminTrainingMetaList(), { text:'Memuat…', overlay:false });
      }
    }

    if (tab === 'geofence'){
      // mount + tarik data terbaru
      Busy.wrap(null, async()=>{
        try{
          await gfMountAdminGeofence();
          UI.setAdminResult('✅ Multi lokasi siap.', true);
        }catch(e){
          if (handleAdminAuthError_(e)) return;
          try{
            gfLoadFromLS();
            gfRenderAdminTable();
          }catch(_e){}
          UI.setAdminResult('⚠️ Gagal sinkron. Menampilkan data lokal.', false);
        }
      }, { text:'Memuat…', overlay:false });
    }
  }

  // event delegation: satu saja (hindari dobel trigger)
  tabsWrap?.addEventListener('click', (e)=>{
    const btn = e.target?.closest?.('.tab2');
    if (!btn) return;
    adminSwitchTab(btn.dataset.atab);
  });

  // default date
  const today = todayISO();
  ['r_start','r_end','l_start','l_end'].forEach(id=>{ const el = $('#'+id); if (el) el.value = today; });

  // actions (tetap sama seperti sebelumnya)
  $('#btn-enroll')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-enroll'),
    async()=> await doEnroll(),
    { text:'Menyimpan…', overlay:true, overlayText:'Enroll: Simpan + Rekam Wajah…' }
  ));

  $('#btn-rekap')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-rekap'),
    async()=> await adminRekap(),
    { text:'Mengambil…', overlay:true, overlayText:'Mengambil Rekap…' }
  ));

  $('#btn-logs')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-logs'),
    async()=> await adminLogs(),
    { text:'Mengambil…', overlay:true, overlayText:'Mengambil Logs…' }
  ));

  $('#btn-export')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-export'),
    async()=> await adminExportCsv(),
    { text:'Export…', overlay:true, overlayText:'Menyiapkan file CSV…' }
  ));

  $('#btn-reconcile-refresh')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-reconcile-refresh'),
    async()=> await adminLoadReconcile(),
    { text:'Memuat…', overlay:true, overlayText:'Memuat permohonan rekonsil…' }
  ));

  $('#btn-delete-failed-att')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-delete-failed-att'),
    async()=> await adminDeleteFailedAttendance(),
    { text:'Menghapus…', overlay:true, overlayText:'Membersihkan data gagal di attendance…' }
  ));

  $('#btn-d-preview')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-d-preview'),
    async()=> await dashPreview(),
    { text:'Preview…', overlay:true, overlayText:'Menyiapkan preview…' }
  ));

  $('#btn-d-xlsx')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-d-xlsx'),
    async()=> await dashExportXlsx(),
    { text:'XLSX…', overlay:true, overlayText:'Membuat XLSX…' }
  ));

  $('#btn-d-pdf')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-d-pdf'),
    async()=> await dashExportPdf(),
    { text:'PDF…', overlay:true, overlayText:'Membuat PDF…' }
  ));

  $('#btn-g-preview')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-g-preview'),
    async()=> await gatePreview(),
    { text:'Preview…', overlay:true, overlayText:'Menyiapkan preview…' }
  ));

  $('#btn-g-xlsx')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-g-xlsx'),
    async()=> await gateExportXlsx(),
    { text:'XLSX…', overlay:true, overlayText:'Membuat XLSX…' }
  ));

  $('#btn-g-pdf')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-g-pdf'),
    async()=> await gateExportPdf(),
    { text:'PDF…', overlay:true, overlayText:'Membuat PDF…' }
  ));

  $('#btn-save-settings')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-save-settings'),
    async()=> await adminSaveSettings(),
    { text:'Simpan…', overlay:true, overlayText:'Menyimpan pengaturan…' }
  ));

  $('#btn-reload-settings')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-reload-settings'),
    async()=> await adminLoadSettingsFromServer(true),
    { text:'Reload…', overlay:true, overlayText:'Memuat pengaturan…' }
  ));

  $('#btn-change-pin')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-change-pin'),
    async()=> await adminChangePin(),
    { text:'Ubah…', overlay:true, overlayText:'Mengubah PIN…' }
  ));

  // training meta buttons
  $('#btn-tm-refresh')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-tm-refresh'),
    async()=> await adminTrainingMetaList(),
    { text:'Memuat…', overlay:false }
  ));
  $('#btn-tm-save')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-tm-save'),
    async()=> await adminTrainingMetaSave(),
    { text:'Simpan…', overlay:true, overlayText:'Menyimpan Training Meta…' }
  ));
  $('#btn-tm-reset')?.addEventListener('click', ()=>{ try{ tmResetForm(); $('#tm_info').textContent=''; }catch(e){} });

  // materi buttons
  $('#btn-m-refresh')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-m-refresh'),
    async()=> await adminLoadMateri(),
    { text:'Memuat…', overlay:false }
  ));
  $('#btn-m-save')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-m-save'),
    async()=> await adminSaveMateri(),
    { text:'Simpan…', overlay:true, overlayText:'Menyimpan Materi…' }
  ));
  $('#btn-m-reset')?.addEventListener('click', ()=>{ try{ resetMateriForm(); $('#materi-info').textContent=''; }catch(e){} });

  // expose (dipakai di beberapa tempat lain)
  window.adminSwitchTab = adminSwitchTab;
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

    // ✅ Autocomplete NIK (Mode: Per Peserta)
    initGateNikAutocomplete(meta);


    // ✅ Tampilkan/sembunyikan field NIK sesuai Mode Laporan
    try{ initGatePersonWrap(); }catch(e){}
  } catch(e){
    UI.setAdminResult(String(e.message || e), false);
  }
}


// Tampilkan/sembunyikan field NIK di Dashboard Mobilitas sesuai Mode Laporan
function initGatePersonWrap(){
  const sel = $('#g_view');
  const wrap = $('#g_person_wrap');
  if (!sel || !wrap) return;
  const refresh = ()=>{
    wrap.style.display = (String(sel.value) === 'person') ? 'grid' : 'none';
  };
  sel.addEventListener('change', refresh);
  refresh();
}

function initGateNikAutocomplete(meta){
  const input = $('#g_nik');
  const dl = $('#dl_g_nik');
  const hint = $('#g_nik_hint');
  const groupSel = $('#g_group');
  if (!input || !dl) return;

  const peserta = Array.isArray(meta?.peserta_small) ? meta.peserta_small : [];
  // simpan utk rebuild/filter
  window.__gatePesertaSmall = peserta;

  const esc = (s)=> String(s??'').replace(/[&<>"']/g, m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'
  }[m]));

  function normalizeNikFromInput(v){
    const s = String(v||'').trim();
    // kalau user memilih "2016xxxx — Nama ..." ambil token awal digit
    const m = s.match(/^(\d{4,})/);
    return m ? m[1] : s;
  }

  function renderHintByNik(nik){
    if (!hint) return;
    if (!nik){ hint.textContent = ''; return; }
    const hit = peserta.find(p => String(p.nik) === String(nik));
    if (!hit){ hint.textContent = 'NIK tidak ditemukan di daftar (boleh lanjut jika data ada di server).'; return; }
    const parts = [hit.nama, hit.group, hit.unit, hit.region].filter(Boolean);
    hint.textContent = parts.join(' • ');
  }

  function rebuildDatalist(filterGroup){
    const g = String(filterGroup || '').trim();
    let list = peserta;
    if (g) list = peserta.filter(p => String(p.group||'') === g);

    // lindungi UI jika daftar sangat besar
    const CAP = 2000;
    if (list.length > CAP) list = list.slice(0, CAP);

    dl.innerHTML = list.map(p=>{
      const label = [p.nik, p.nama, p.group, p.unit].filter(Boolean).join(' — ');
      // value tetap NIK (agar input langsung valid)
      return `<option value="${esc(p.nik)}">${esc(label)}</option>`;
    }).join('');
  }

  // initial
  rebuildDatalist(groupSel?.value || '');
  renderHintByNik(normalizeNikFromInput(input.value));

  // events
  input.addEventListener('input', ()=>{
    const nik = normalizeNikFromInput(input.value);
    // jika user menempel label panjang, auto-normalize setelah jeda
    if (nik && nik !== input.value && /^\d{4,}$/.test(nik)){
      // jangan terlalu agresif saat user masih mengetik
    }
    renderHintByNik(nik);
  });
  input.addEventListener('blur', ()=>{
    const nik = normalizeNikFromInput(input.value);
    if (nik && nik !== input.value) input.value = nik;
    renderHintByNik(nik);
  });

  groupSel?.addEventListener('change', ()=>{
    rebuildDatalist(groupSel.value || '');
    renderHintByNik(normalizeNikFromInput(input.value));
  });
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
  if (!isAdminSessionValid()){
    UI.setAdminResult('Sesi admin habis. Login ulang.', false);
    const sum = $('#d_summary');
    if (sum) sum.textContent = 'Sesi admin habis. Login ulang.';
    return;
  }

  const date = ($('#d_date').value || '').trim();

  if (!date){
    const sum = $('#d_summary');
    if (sum) sum.textContent = 'Tanggal wajib diisi.';
    try{ $('#d_date')?.focus(); }catch(e){}
    return;
  }
  const group = ($('#d_group').value || '').trim();
  const training_type = ($('#d_training_type').value || '').trim();

  if (!training_type){
    const sum = $('#d_summary');
    if (sum) sum.textContent = 'Training Type wajib dipilih.';
    try{ $('#d_training_type')?.focus(); }catch(e){}
    return;
  }
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
  if (!isAdminSessionValid()){
    UI.setAdminResult('Sesi admin habis. Login ulang.', false);
    const sum = $('#g_summary');
    if (sum) sum.textContent = 'Sesi admin habis. Login ulang.';
    return;
  }

  const start = ($('#g_start').value || '').trim();
  const end = ($('#g_end').value || '').trim();
  let view = ($('#g_view').value || 'daily').trim();
  const gate_reason = ($('#g_reason').value || '').trim();
  const nik = ($('#g_nik').value || '').trim();
  const group = ($('#g_group').value || '').trim();

  if (!start || !end){
    const sum = $('#g_summary');
    if (sum) sum.textContent = 'Tanggal Mulai & Akhir wajib diisi.';
    try{ (!start ? $('#g_start') : $('#g_end'))?.focus(); }catch(e){}
    return;
  }
  // UX guard:
// Mode "Per Peserta" membutuhkan NIK.
// Daripada melempar error (yang jadi "Uncaught (in promise) ..."), kita tampilkan pesan + fokus ke field NIK.
if (view === 'person' && !nik){
  const wrap = document.getElementById('g_person_wrap');
  if (wrap) wrap.style.display = 'grid';
  const sum = document.getElementById('g_summary');
  if (sum) sum.textContent = 'Mode "Per Peserta" membutuhkan NIK. Silakan isi NIK terlebih dahulu.';
  const input = document.getElementById('g_nik');
  try{ input?.focus(); }catch(e){}
  return;
}

  const r = await api('adminGateReport', {
    admin_token: State.adminToken,
    start, end, view, gate_reason, nik, group
  });

  if (!r.ok) throw new Error(r.error || 'Gagal membuat report mobilitas');

  $('#g_summary').textContent = r.summary_text || `Rows: ${(r.rows||[]).length}`;
  renderGateTable(view, r.rows || []);
}

// =========================
// Compat aliases (dashboard buttons) 
// Setelah refactor: fungsi lama dipanggil dashPreview/dashExport...,
// sedangkan implementasi barunya bernama adminPreviewTraining/adminPreviewGate/adminExportDashboard.
// Aliases ini mencegah error: "dashPreview is not defined".
// =========================
async function dashPreview(){
  return await adminPreviewTraining();
}
async function dashExportXlsx(){
  return await adminExportDashboard('xlsx', 'training');
}
async function dashExportPdf(){
  return await adminExportDashboard('pdf', 'training');
}
async function gatePreview(){
  return await adminPreviewGate();
}
async function gateExportXlsx(){
  return await adminExportDashboard('xlsx', 'gate');
}
async function gateExportPdf(){
  return await adminExportDashboard('pdf', 'gate');
}

// Expose aliases to window (extra safety untuk variasi load script)
try{
  window.dashPreview = dashPreview;
  window.dashExportXlsx = dashExportXlsx;
  window.dashExportPdf = dashExportPdf;
  window.gatePreview = gatePreview;
  window.gateExportXlsx = gateExportXlsx;
  window.gateExportPdf = gateExportPdf;
}catch(e){}


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

/* =========================
   Autocomplete NIK (Gate dashboard)
   - Sumber: adminPesertaMeta().peserta_small
   - UI: <input list="dl_g_nik"> + hint nama
   ========================= */
function initGateNikAutocomplete(meta){
  try{
    const inp = $('#g_nik');
    const dl  = $('#dl_g_nik');
    const hint= $('#g_nik_hint');
    const selGroup = $('#g_group');
    if (!inp || !dl) return;

    const all = Array.isArray(meta?.peserta_small) ? meta.peserta_small : [];
    // simpan untuk rebuild
    window.__gatePesertaSmall = all;

    const normalizeNik = (v)=>{
      const s = String(v||'').trim();
      const m = s.match(/(\d{4,})/); // ambil angka pertama (minimal 4 digit)
      return m ? m[1] : '';
    };

    const render = (groupFilter)=>{
      const list = window.__gatePesertaSmall || [];
      const filtered = groupFilter
        ? list.filter(p=> String(p.group||'').trim() === groupFilter)
        : list;

      // batasi opsi agar tidak terlalu berat untuk browser mobile
      const MAX = 1200;
      const rows = filtered.slice(0, MAX);
      dl.innerHTML = rows.map(p=>{
        const nik = String(p.nik||'').trim();
        const nama = String(p.nama||'').trim();
        const grp = String(p.group||'').trim();
        const unit = String(p.unit||'').trim();
        const label = [nama, grp, unit].filter(Boolean).join(' • ');
        // value = nik, text = label (Chrome akan menampilkan salah satu/dua-duanya)
        return `<option value="${escapeHtml(nik)}">${escapeHtml(label)}</option>`;
      }).join('');
    };

    const updateHint = ()=>{
      const nik = normalizeNik(inp.value);
      if (!nik){ if (hint) hint.textContent = ''; return; }
      // pastikan input hanya nik bila user memilih format lain
      inp.value = nik;
      const list = window.__gatePesertaSmall || [];
      const p = list.find(x=> String(x.nik||'').trim() === nik);
      if (hint){
        hint.textContent = p
          ? `Terpilih: ${p.nama || '-'}${p.group?` • ${p.group}`:''}${p.unit?` • ${p.unit}`:''}`
          : 'NIK tidak ditemukan di master peserta.';
      }
    };

    // initial render (semua)
    render('');

    // bila group dipilih, sempitkan suggestion (lebih enak untuk mencari)
    selGroup?.addEventListener('change', ()=>{
      const g = (selGroup.value||'').trim();
      render(g);
      // tidak menghapus nik yang sudah dipilih, hanya mengubah suggestion
      updateHint();
    });

    // saat user mengetik / memilih
    inp.addEventListener('change', updateHint);
    inp.addEventListener('blur', updateHint);
    inp.addEventListener('input', ()=>{ if (hint) hint.textContent=''; });

  }catch(e){
    // non-fatal
    console.warn('initGateNikAutocomplete failed:', e);
  }
}

async function main(){
  // SECTION: Startup Overlay
  try{
    UI.setStatus('⏳ Aplikasi sedang disiapkan…');
    busyOverlay(true, 'Aplikasi sedang disiapkan…'); // ✅ overlay startup
  }catch(e){}

  try{
    State.deviceId = getOrCreateDeviceId();
    $('#device-info').innerHTML = `Device ID: <b>${escapeHtml(State.deviceId)}</b>`;

    gfLoadFromLS();

    try{
      setTimeout(() => {
        try{
          if (window.gfEnsureFreshFromServer){
            window.gfEnsureFreshFromServer({ maxAgeMs: 6*60*60*1000 }).catch(()=>{});
          }
        }catch(e){}
      }, 150);
    }catch(e){}

    initMode();
    initTraining();
    initAdminModal();
    initCameraModals();

    $('#btn-checkloc').addEventListener('click', ()=> Busy.wrap(
      $('#btn-checkloc'),
      async()=>{
        try{
          if (window.gfEnsureFreshFromServer){
            await window.gfEnsureFreshFromServer({ maxAgeMs: 6*60*60*1000 });
          }
          await checkLocation({ force:true, silent:false });
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

    // ✅ load config dulu (agar liveness/threshold/geofence siap)
    await loadConfig(true);

    // ✅ AUTO cek lokasi saat aplikasi load/refresh
    updateLocPill();
    try{
      if (window.gfEnsureFreshFromServer){
        await window.gfEnsureFreshFromServer({ maxAgeMs: 6*60*60*1000 });
      }
      await checkLocation({ force:false, silent:true, maxAgeMs:45000 });
      updatePresensiReadyMessage();
    } catch(e){
      // silent
    }

    updateLocPill();
    validateEnablePresensi();
    smartStatusUpdate(true);

    // warm up models
    try{ await loadModels(); } catch(e){ /* retry on demand */ }

  } catch(err){
    console.error(err);
    try{ UI.setResult(String(err?.message || err), false); }catch(e){}
  } finally {
    // ✅ Tutup overlay setelah semua init selesai (sukses/gagal)
    try{ busyOverlay(false); }catch(e){}
    try{ UI.setStatus('✅ Siap'); }catch(e){}
  }
}

main();