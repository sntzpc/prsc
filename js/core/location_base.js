let __gfWarmPromise = null;

function gfWarmupOnce({ force = false, maxAgeMs = 6*60*60*1000 } = {}){
  if (!window.gfEnsureFreshFromServer) return Promise.resolve({ ok:false, source:'no_geofence_core' });

  if (force || !__gfWarmPromise){
    __gfWarmPromise = window.gfEnsureFreshFromServer({ maxAgeMs })
      .catch(err => ({ ok:false, source:'warmup_error', error: String(err?.message || err) }));
  }
  return __gfWarmPromise;
}

async function loadConfig(force=false){
  if (!force && State.cfg && State.cfg.ok) return;
  const r = await api('config', { t: Date.now() }); // cache buster
  if (r && r.ok) State.cfg = r;
}

// haversine in meters
function haversineM(lat1,lng1,lat2,lng2){
  const R=6371000;
  const toRad = (d)=> d*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

function updateLocPill(){
  const pill = document.getElementById('loc-status');
  if (!pill) return;

  // status/error
  if (State.locError){
    pill.textContent = '❌ Lokasi: ' + State.locError;
    pill.classList.remove('ok');
    pill.classList.add('bad');
    return;
  }

  if (!isFinite(State.loc.lat) || !isFinite(State.loc.lng)){
    pill.textContent = '📍 Lokasi belum tersedia';
    pill.classList.remove('ok');
    pill.classList.add('warn');
    return;
  }

  const d = isFinite(State.loc.distance_m) ? Math.round(State.loc.distance_m) : null;
  const inside = !!State.loc.inFence;

  const name = State.loc?.fence?.name ? ` • ${State.loc.fence.name}` : '';
  const txtD = (d==null) ? '' : ` • ${d}m`;
  pill.textContent = (inside ? '✅ Dalam Area' : '⚠️ Di luar Area') + name + txtD;

  pill.classList.toggle('ok', inside);
  pill.classList.toggle('bad', !inside);
  pill.classList.remove('warn');
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

// ===== Live location ping (public) =====
let __lastLivePingAt = 0;
async function livePingIfNeeded(pos){
  try{
    if (!pos || !pos.coords) return;
    const now = Date.now();
    if (now - __lastLivePingAt < 25000) return; // max ~1x/25s
    __lastLivePingAt = now;

    // deviceId dari core/device.js
    const device_id = (State.deviceId || localStorage.getItem('device_id') || '');
    if (!device_id) return;

    await api('live.ping', {
      device_id,
      name: String(State?.user?.name || ''), // optional
      lat: Number(pos.coords.latitude),
      lng: Number(pos.coords.longitude),
      accuracy_m: Number(pos.coords.accuracy || 0),
      ua: String(navigator.userAgent||'').slice(0,180),
      t: now
    });
  }catch(e){
    // silent
  }
}

/* =========================
   checkLocation()
   - Ambil posisi perangkat (GPS)
   - Ambil multi lokasi aktif terdekat (AUTO pull dari server jika lokal kosong/kadaluarsa)
   - Fallback ke geofence default dari config server jika tidak ada multi lokasi
   - Update State.loc + pill
   ========================= */
async function checkLocation({ force=false, silent=false, maxAgeMs=45000 } = {}){
  // throttling
  const now = Date.now();
  if (!force && (now - (State.locCheckedAt||0)) < 2500) {
    return State.loc;
  }

  State.locCheckedAt = now;
  State.locError = '';

  try{
    await loadConfig(false);

    const pos = await getLocation({ maximumAge: maxAgeMs });
    const lat = Number(pos.coords.latitude);
    const lng = Number(pos.coords.longitude);
    const acc = Number(pos.coords.accuracy || 0);

    State.loc.lat = lat;
    State.loc.lng = lng;
    State.loc.accuracy_m = acc;

    // 1) pastikan punya multi-lokasi (auto pull)
    const ensured = await gfWarmupOnce({ force: !!force, maxAgeMs: force ? 0 : 6*60*60*1000 });
    const actives = (ensured && Array.isArray(ensured.points) && ensured.points.length)
      ? ensured.points
      : (window.gfActivePoints ? window.gfActivePoints() : []);

    // 2) hitung nearest
    let nearest = null;

    if (actives && actives.length){
      nearest = computeNearestFence(lat, lng, actives);
    }

    // 3) fallback ke default server config (single)
    if (!nearest && State.cfg && State.cfg.ok && State.cfg.geofence?.center){
      const c = State.cfg.geofence.center;
      const p = {
        id: 'default',
        name: 'Default',
        lat: Number(c.lat),
        lng: Number(c.lng),
        radius_m: Number(State.cfg.geofence.radius_m || 50),
        active: true
      };
      nearest = computeNearestFence(lat, lng, [p]);
    }

    if (!nearest){
      State.loc.distance_m = null;
      State.loc.inFence = false;
      State.loc.fence = null;
      throw new Error('Belum ada geofence terdaftar (server & lokal kosong).');
    }

    State.loc.distance_m = nearest.distance_m;
    State.loc.fence = nearest.point;
    State.loc.inFence = isInsideFence(nearest.distance_m, Number(nearest.point.radius_m));

    // ping lokasi untuk Live Map (public)
    livePingIfNeeded(pos);

    if (!silent) updateLocPill();
    return State.loc;
  }catch(err){
    State.locError = (err && err.message) ? err.message : String(err||'Gagal cek lokasi');
    State.loc.inFence = false;
    if (!silent) updateLocPill();
    throw err;
  }
}

window.loadConfig = loadConfig;
window.haversineM = haversineM;
window.getLocation = getLocation;
window.updateLocPill = updateLocPill;
window.checkLocation = checkLocation;
