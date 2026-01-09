// SECTION: Admin Page - Multi Lokasi (Geofence)
// Purpose : UI + CRUD for multi lokasi in Admin modal; sync/download from server.
// Depends : core/base.js, core/api.js, core/geofence_core.js, core/location_base.js.
// Provides: adminInitGeofencePane(), adminLoadGeofences(), adminRenderGeofenceList(), checkLocation() hook.

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

