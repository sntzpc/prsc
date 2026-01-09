// SECTION: Core Location
// Purpose : Load config, request geolocation, compute distance, and update location UI pill.
// Depends : js/core/base.js (State, UI, $), navigator.geolocation.
// Provides: loadConfig(), getLocation(), haversineM(), updateLocPill(), checkLocation() base pieces.

/* =========================
   Geo + Config
   ========================= */
async function loadConfig(force=false){
  if (!force && State.cfg && State.cfg.ok) return;
  const r = await api('config', { t: Date.now() }); // cache buster
  if (r.ok) State.cfg = r;
}

function haversineM(lat1,lng1,lat2,lng2){
  const R=6371000;
  const toRad = x => x*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLng=toRad(lng2-lng1);
  const A = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  const C = 2*Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
  return R*C;
}

function updateLocPill(){
  const pill = $('#loc-status');
  const L = State.loc;

  // ✅ jika ada error lokasi (izin ditolak, timeout, dll)
  if (State.locError){
    pill.textContent = 'Lokasi belum diizinkan / error';
    pill.style.borderStyle = 'dashed';
    return;
  }

  if (!isFinite(L.distance_m)){
    pill.textContent = 'Sedang cek lokasi…';
    pill.style.borderStyle = 'dashed';
    return;
  }

  pill.textContent = L.inFence
  ? `Di area (${Math.round(L.distance_m)} m) • ${L.fence_name || 'Lokasi'}`
  : `Di luar area (${Math.round(L.distance_m)} m)`;

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

