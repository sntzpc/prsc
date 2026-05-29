// SECTION: Admin Page - Settings
// Purpose : Admin settings UI (threshold, geofence policy, camera preferences, etc.) and persistence to server.
// Depends : core/base.js, core/api.js, core/admin_session.js, core/busy.js.
// Provides: adminLoadSettings(), adminSaveSettings(), applySettingsToUI().

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

