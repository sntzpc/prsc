// SECTION: Core Geofence (Legacy/Compatibility)
// Purpose : Backward compatibility layer (older geofence helpers) if referenced by older code.
// Notes   : Prefer js/core/geofence_core.js + js/pages/geofence_admin.js.

/* =========================================================
   ✅ MULTI GEOFENCE (Frontend Controlled)
   - Simpan titik di localStorage (CRUD + aktif/nonaktif)
   - checkLocation() akan pakai titik aktif (nearest)
   - fallback ke config server (single geofence) jika list kosong
   ========================================================= */

const GEOF = {
  LS_KEY: 'geofence_points_v1',
  // point: { id, name, lat, lng, radius_m, active }
  points: []
};

function gfUid(){
  return 'gf_' + Math.random().toString(16).slice(2) + '_' + Date.now();
}

function gfLoadFromLS(){
  try{
    const raw = localStorage.getItem(GEOF.LS_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    const pts = Array.isArray(obj?.points) ? obj.points : [];
    GEOF.points = pts.map(p=>({
      id: String(p.id || gfUid()),
      name: String(p.name || 'Titik'),
      lat: Number(p.lat),
      lng: Number(p.lng),
      radius_m: Number(p.radius_m || 50),
      active: (String(p.active ?? 'TRUE').toUpperCase() !== 'FALSE')
    })).filter(p => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radius_m));
  }catch(e){
    GEOF.points = [];
  }
}

function gfSaveToLS(){
  try{
    localStorage.setItem(GEOF.LS_KEY, JSON.stringify({
      points: GEOF.points,
      savedAt: Date.now()
    }));
  }catch(e){}
}

function gfActivePoints(){
  return (GEOF.points || []).filter(p => !!p.active);
}

