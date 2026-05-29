// SECTION: Core Device Identity
// Purpose : Create/read a stable deviceId (stored in localStorage) used by presensi/logging.
// Depends : js/core/base.js (State), localStorage.
// Provides: getOrCreateDeviceId().

/* =========================
   Device ID (binding)
   ========================= */
function getOrCreateDeviceId(){
  let id = localStorage.getItem('device_id');
  if (!id){
    id = (crypto?.randomUUID?.() || (Date.now()+'-'+Math.random().toString(16).slice(2)));
    localStorage.setItem('device_id', id);
  }
  return id;
}

