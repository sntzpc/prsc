// SECTION: Core Multi-Geofence Engine
// Purpose : Store/manage multiple geofence points and compute nearest/inside fence.
// Depends : js/core/base.js (State), js/core/location_base.js (haversineM).
// Provides: GeofenceStore (get/set/import/export), computeNearestFence(), isInsideFence().
//
// NOTE:
// - Titik geofence disimpan di localStorage agar bisa dipakai offline.
// - Aplikasi akan otomatis menarik titik geofence aktif dari server (public) jika lokal kosong / kadaluarsa.

const GEOF = {
  LS_KEY: 'geofence_points_v1',
  LS_TS_KEY: 'geofence_points_v1_ts',
  points: []
};

function gfUid(){
  return 'gf_' + Math.random().toString(16).slice(2) + '_' + Date.now();
}

function gfNormPoint(p){
  return {
    id: String(p.id || gfUid()),
    name: String(p.name || 'Titik'),
    lat: Number(p.lat),
    lng: Number(p.lng),
    radius_m: Number(p.radius_m || 50),
    active: (String(p.active ?? 'TRUE').toUpperCase() !== 'FALSE'),
    sort: Number(p.sort || 0),
    updated_at: String(p.updated_at || ''),
    updated_by: String(p.updated_by || '')
  };
}

function gfLoadFromLS(){
  try{
    const raw = localStorage.getItem(GEOF.LS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    const pts = Array.isArray(obj?.points) ? obj.points : (Array.isArray(obj) ? obj : []);
    GEOF.points = pts.map(gfNormPoint)
      .filter(p => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radius_m) && p.radius_m > 0);
  }catch(e){
    GEOF.points = [];
  }
  return GEOF.points;
}

function gfSaveToLS(){
  try{
    localStorage.setItem(GEOF.LS_KEY, JSON.stringify({ points: GEOF.points, savedAt: Date.now() }));
    localStorage.setItem(GEOF.LS_TS_KEY, String(Date.now()));
  }catch(e){}
}

function gfSetPoints(points){
  GEOF.points = (points || []).map(gfNormPoint)
    .filter(p => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radius_m) && p.radius_m > 0);
  gfSaveToLS();
  return GEOF.points;
}

function gfActivePoints(){
  return (GEOF.points || []).filter(p => !!p.active);
}

function computeNearestFence(lat, lng, points){
  const pts = (points || []).filter(p => isFinite(p.lat) && isFinite(p.lng));
  if (!pts.length) return null;

  let best = null;
  for (const p of pts){
    const d = haversineM(lat, lng, p.lat, p.lng);
    if (!best || d < best.distance_m){
      best = { point: p, distance_m: d };
    }
  }
  return best;
}

function isInsideFence(distance_m, radius_m){
  if (!isFinite(distance_m) || !isFinite(radius_m)) return false;
  return distance_m <= radius_m;
}

// ===== Server pull (public) =====
async function gfPullActiveFromServer(){
  // endpoint public: action = geofence.list
  const r = await api('geofence.list', { t: Date.now() });
  if (!r || !r.ok) throw new Error(r?.error || 'Gagal mengambil multi lokasi dari server');
  const items = Array.isArray(r.items) ? r.items : [];
  return items.map(gfNormPoint).filter(p => !!p.active);
}

async function gfEnsureFreshFromServer({ maxAgeMs = 6*60*60*1000 } = {}){
  // jika belum pernah ada titik di local, atau sudah kadaluarsa, tarik ulang dari server
  const ts = Number(localStorage.getItem(GEOF.LS_TS_KEY) || 0);
  gfLoadFromLS();
  const hasLocal = gfActivePoints().length > 0;

  const stale = (!ts) || ((Date.now() - ts) > maxAgeMs);
  if (hasLocal && !stale) return { ok:true, source:'local', points: gfActivePoints() };

  try{
    const active = await gfPullActiveFromServer();
    if (active.length){
      gfSetPoints(active); // simpan aktif saja (lebih aman utk publik)
      return { ok:true, source:'server', points: active };
    }
    // kalau server kosong, tetap pakai lokal
    return { ok:true, source: hasLocal ? 'local' : 'empty', points: gfActivePoints() };
  }catch(e){
    // gagal tarik server -> fallback local
    return { ok: hasLocal, source:'local_fallback', points: gfActivePoints(), error: String(e?.message||e) };
  }
}

// expose (optional) for other modules
window.GEOF = GEOF;
window.gfLoadFromLS = gfLoadFromLS;
window.gfSaveToLS = gfSaveToLS;
window.gfSetPoints = gfSetPoints;
window.gfActivePoints = gfActivePoints;
window.computeNearestFence = computeNearestFence;
window.isInsideFence = isInsideFence;
window.gfEnsureFreshFromServer = gfEnsureFreshFromServer;
