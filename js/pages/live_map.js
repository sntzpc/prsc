// Live Map (public) - Leaflet (FG/Presensi)
// - Public view: geofences + live devices + "me" marker (optional)
// - Fix: bounds for layerGroup (avoid i.getLatLng is not a function)
// - Enhancements: colored geofences + permanent labels + nicer popups + validation + non-overlap refresh

(() => {
  const $ = (s, r=document)=> r.querySelector(s);

  const connPill = $('#conn-pill');
  const gfCount  = $('#gf-count');
  const gfList   = $('#gf-list');
  const dvCount  = $('#dv-count');
  const dvList   = $('#dv-list');
  const lastUpd  = $('#last-upd');

  const btnRefresh = $('#btn-refresh');
  const btnCenter  = $('#btn-center');

  let map, meMarker;

  const geofenceLayer = L.layerGroup();
  const deviceLayer   = L.layerGroup();

  const GF_LABEL_MIN_ZOOM = 15;
  const gfAutoTooltips = [];

  function updateGeofenceLabelsByZoom(){
    if (!map) return;
    const z = map.getZoom();

    for (const tt of gfAutoTooltips){
      // Leaflet tooltip object: setOpacity aman dipakai
      try{
        tt.setOpacity(z >= GF_LABEL_MIN_ZOOM ? 0.95 : 0);
      }catch{}
    }
  }

  // ===== UI helpers =====
  function setConn(ok, msg){
    if (!connPill) return;
    connPill.textContent = (ok ? '✅ ' : '⚠️ ') + (msg || '');
    connPill.style.borderColor = ok ? 'rgba(34,197,94,.55)' : 'rgba(245,158,11,.55)';
  }

  function escapeHtml(str){
    return String(str ?? '').replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m]));
  }

  function fmtTime(ts){
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n)=> String(n).padStart(2,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function isFiniteLatLng(lat, lng){
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }

  function clearLayer(layer){
    try { layer.clearLayers(); } catch {}
  }

  // ===== Color utilities (deterministic per id/name) =====
  function hashStr(s){
    s = String(s ?? '');
    let h = 2166136261;
    for (let i=0; i<s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function colorFromKey(key){
    const h = hashStr(key);
    const hue = h % 360;
    // use HSL -> nice readable colors
    // (Leaflet wants CSS color strings)
    return {
      stroke: `hsl(${hue} 85% 45%)`,
      fill:   `hsl(${hue} 85% 55%)`
    };
  }

  // ===== Map init =====
  function initMap(){
    map = L.map('map', { zoomControl:true });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    geofenceLayer.addTo(map);
    deviceLayer.addTo(map);

    // default view (Indonesia approx)
    map.setView([-2.5, 117.5], 5);
  }

  // ===== Safe bounds computation (works for marker/circle/etc inside layerGroup) =====
  function computeBounds(){
    const bounds = L.latLngBounds([]);

    const layers = [
      ...geofenceLayer.getLayers(),
      ...deviceLayer.getLayers(),
      ...(meMarker ? [meMarker] : [])
    ];

    for (const lyr of layers){
      if (!lyr) continue;

      // Circle/Polygon has getBounds
      if (typeof lyr.getBounds === 'function'){
        try { bounds.extend(lyr.getBounds()); } catch {}
        continue;
      }

      // Marker has getLatLng
      if (typeof lyr.getLatLng === 'function'){
        try{
          const ll = lyr.getLatLng();
          const lat = Number(ll?.lat), lng = Number(ll?.lng);
          if (isFiniteLatLng(lat, lng)) bounds.extend([lat, lng]);
        }catch{}
      }
    }
    return bounds;
  }

  // ===== Geolocation =====
  async function getMyLocation(){
    return new Promise((resolve, reject)=>{
      if (!navigator.geolocation) return reject(new Error('Geolocation tidak didukung'));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy:true,
        timeout:15000,
        maximumAge:10000
      });
    });
  }

  // ===== Render: Geofences =====
  function geofencePopupHtml(p, lat, lng, rad, c){
    const name = escapeHtml(p.name || p.label || p.id || 'Lokasi');
    const id   = escapeHtml(p.id || '');
    const desc = escapeHtml(p.description || p.desc || '');
    const loc  = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    return `
      <div style="min-width:220px;line-height:1.25">
        <div style="font-weight:800;font-size:14px;margin-bottom:6px">${name}</div>
        ${id ? `<div style="opacity:.75;font-size:12px;margin-bottom:6px">ID: <code>${id}</code></div>` : ``}
        <div style="display:flex;gap:10px;font-size:12px;opacity:.9;margin-bottom:8px">
          <div><b>Radius</b><br/>${rad} m</div>
          <div><b>Koordinat</b><br/>${loc}</div>
        </div>
        ${desc ? `<div style="font-size:12px;opacity:.85">${desc}</div>` : ``}
        <div style="margin-top:8px;font-size:11px;opacity:.7">
          <span style="display:inline-block;width:10px;height:10px;border-radius:99px;background:${c.stroke};vertical-align:middle;margin-right:6px"></span>
          Warna acak
        </div>
      </div>
    `;
  }

  function renderGeofences(items){
    clearLayer(geofenceLayer);
    gfAutoTooltips.length = 0;

    const safe = Array.isArray(items) ? items : [];
    if (gfCount) gfCount.textContent = `(${safe.length})`;

    const lines = [];
    for (const p of safe){
      const lat = Number(p.lat), lng = Number(p.lng);
      if (!isFiniteLatLng(lat, lng)) continue;

      const rad = Number(p.radius_m || p.radius || 50) || 50;

      const key = p.id || p.name || `${lat},${lng}`;
      const c = colorFromKey(key);

      const name = p.name || p.label || p.id || 'Lokasi';
      lines.push(`• ${name} @ ${lat.toFixed(6)},${lng.toFixed(6)} r=${rad}m`);

      // colored circle
      const circle = L.circle([lat, lng], {
        radius: rad,
        color: c.stroke,
        weight: 2,
        opacity: 0.9,
        fillColor: c.fill,
        fillOpacity: 0.25
      });

      circle.bindPopup(geofencePopupHtml(p, lat, lng, rad, c));
      circle.addTo(geofenceLayer);

      // center marker
      const m = L.circleMarker([lat, lng], {
        radius: 6,
        color: c.stroke,
        weight: 2,
        fillColor: c.stroke,
        fillOpacity: 0.9
      });

      m.bindPopup(geofencePopupHtml(p, lat, lng, rad, c));
      m.addTo(geofenceLayer);

      // permanent label (tooltip)
      const tt = m.bindTooltip(escapeHtml(name), {
        permanent: true,
        direction: 'top',
        offset: [0, -8],
        opacity: 0.9,
        className: 'gf-label',
        sticky: true
      }).getTooltip();
      if (tt) gfAutoTooltips.push(tt);
    }

    if (gfList) gfList.textContent = lines.join('\n') || '(kosong)';
  }

  // ===== Render: Devices =====
  function devicePopupHtml(d, lat, lng){
    const name = escapeHtml(d.name || d.device_id || d.deviceId || 'device');
    const tRaw = d.updated_at || d.timestamp || d.last_seen || '';
    const t    = fmtTime(tRaw);
    const acc  = d.accuracy_m || d.acc || '';
    const loc  = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    return `
      <div style="min-width:220px;line-height:1.25">
        <div style="font-weight:800;font-size:14px;margin-bottom:6px">${name}</div>
        <div style="display:flex;gap:10px;font-size:12px;opacity:.9;margin-bottom:8px">
          <div><b>Koordinat</b><br/>${loc}</div>
          <div><b>Update</b><br/>${escapeHtml(t || '-')}</div>
        </div>
        <div style="font-size:12px;opacity:.85">
          Akurasi: <b>${escapeHtml(acc ? String(acc) : '-')}</b> m
        </div>
      </div>
    `;
  }

  function renderDevices(items){
    clearLayer(deviceLayer);

    const safe = Array.isArray(items) ? items : [];
    if (dvCount) dvCount.textContent = `(${safe.length})`;

    const lines = [];
    for (const d of safe){
      const lat = Number(d.lat), lng = Number(d.lng);
      if (!isFiniteLatLng(lat, lng)) continue;

      const name = d.name || d.device_id || d.deviceId || 'device';
      const tRaw = d.updated_at || d.timestamp || d.last_seen || '';
      lines.push(`• ${name} @ ${lat.toFixed(6)},${lng.toFixed(6)} • ${fmtTime(tRaw)}`);

      const m = L.marker([lat, lng]);
      m.bindPopup(devicePopupHtml(d, lat, lng));
      m.addTo(deviceLayer);
    }

    if (dvList) dvList.textContent = lines.join('\n') || '(belum ada perangkat yang mengirim lokasi)';
  }

  // ===== Refresh logic (avoid overlapping calls) =====
  let refreshing = false;

  async function refreshAll({centerToMe=false} = {}){
    if (refreshing) return;
    refreshing = true;

    try{
      setConn(true, 'Memuat data…');

      // geofence
      const g = await api('geofence.list', { t: Date.now() });
      if (!g?.ok) throw new Error(g?.error || 'Gagal load geofence');
      const geofences = Array.isArray(g.items) ? g.items : [];
      renderGeofences(geofences);
      updateGeofenceLabelsByZoom();

      // devices (max_age_min: 180 = 3 jam terakhir)
      const d = await api('live.list', { max_age_min: 180, t: Date.now() });
      if (!d?.ok) throw new Error(d?.error || 'Gagal load perangkat');
      const devices = Array.isArray(d.items) ? d.items : [];
      renderDevices(devices);

      if (lastUpd) lastUpd.textContent = 'Update: ' + fmtTime(Date.now());

      // center logic
      if (centerToMe){
        const pos = await getMyLocation();
        const lat = pos.coords.latitude, lng = pos.coords.longitude;

        if (!meMarker){
          meMarker = L.marker([lat, lng]).addTo(map);
          meMarker.bindPopup('<b>Saya</b>');
        }else{
          meMarker.setLatLng([lat, lng]);
        }
        map.setView([lat, lng], 17);
      }else{
        const bounds = computeBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
      }

      setConn(true, 'Online');
    }catch(e){
      setConn(false, e?.message || String(e));
    }finally{
      refreshing = false;
    }
  }

  // ===== Inject small CSS for labels (optional, safe) =====
  function injectLabelCss(){
    const css = `
      .gf-label{
        background: rgba(15,23,42,.75);
        color: #fff;
        border: 1px solid rgba(255,255,255,.18);
        box-shadow: 0 6px 18px rgba(0,0,0,.15);
        border-radius: 10px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
      }
      .leaflet-tooltip.gf-label:before{ display:none; }
    `;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ===== boot =====
  injectLabelCss();
  initMap();
  map.on('zoomend', updateGeofenceLabelsByZoom);
  refreshAll();

  btnRefresh?.addEventListener('click', ()=> refreshAll());
  btnCenter?.addEventListener('click', ()=> refreshAll({ centerToMe:true }));

  // auto refresh every 15s
  setInterval(()=> refreshAll(), 15000);
})();
