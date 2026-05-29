// SECTION: App Init Helpers (Optional)
// Purpose : Reserved for future split of app.js init wiring (kept for compatibility).
// Depends : core/base.js.
// Notes   : This file may be unused depending on index.html.

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
