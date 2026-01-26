/***** CONFIG *****/
const SHEET_USERS = 'users';
const SHEET_ATT = 'attendance';
const SHEET_PESERTA = 'peserta';
const SHEET_SETTINGS  = 'settings';
const SHEET_TRAINING_META = 'training_meta';
const SHEET_MATERIALS = 'materials';
const SHEET_GEOFENCE_POINTS = 'geofence_points';

// Ganti dengan Folder ID Google Drive Anda
const FACES_FOLDER_ID = '1Z42pzuNuw5ZNoE7EovI1Ifrf3ppzJmiS';

// Geo-fence pusat (ganti koordinat Training Center Anda)
const GEOFENCE_CENTER = { lat: 0.958933, lng: 111.889729 };
const GEOFENCE_RADIUS_M = 200; // radius meter

const FACE_DISTANCE_THRESHOLD = 0.52; // tuning 0.45–0.60

// Admin auth
const PROP = PropertiesService.getScriptProperties();
const ADMIN_PIN_HASH_KEY = 'ADMIN_PIN_HASH';
const ADMIN_TOKEN_KEY    = 'ADMIN_TOKEN_HASH'; // rolling token hash
const TOKEN_TTL_MIN = 12 * 60; // 12 jam

/***** ANTI DUPLICATE (BACKEND) *****/
// TTL cache untuk tanda duplicate (detik). 180 detik = 3 menit (cukup aman untuk retry/double click).
const DEDUP_TTL_SEC = 180;

// Window menit yang dianggap sama: ±1 menit
const DEDUP_WINDOW_MIN = 1;


function doGet(e) {
  try {
    // Jika ada payload `p`, anggap sebagai API request dari GitHub Pages
    if (e && e.parameter && e.parameter.p) {
      const body = decodePayload_(e.parameter.p);
      return handleApi_(body);
    }

    // Jika tidak ada payload `p`, (opsional) tampilkan UI versi GAS (kalau masih dipakai)
    return HtmlService.createHtmlOutputFromFile('index.html')
      .setTitle('Presensi Training Center')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);

  } catch (err) {
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

// Router action -> handler (dipakai oleh doGet payload)
function handleApi_(body){
  const action = body.action;
  if (!action) return json_({ ok:false, error:'Missing action' });

  // public
  if (action === 'config') {
    const cfg = getDynamicConfig_();
    return json_({
      ok: true,
      geofence: cfg.geofence,
      threshold: cfg.threshold,
      liveness: cfg.liveness,
      device_detect: cfg.device_detect,

      // ✅ tambahan utk NameTag
      nametag: cfg.nametag,
      nametag_layouts: (cfg.nametag && cfg.nametag.layouts) ? cfg.nametag.layouts : {},
      nametag_slider_bounds: (cfg.nametag && cfg.nametag.slider_bounds) ? cfg.nametag.slider_bounds : {}
    });
  }
  if (action === 'materialsSuggest') return json_(materialsSuggest_(body));
  if (action === 'verifyAndLog') return json_(verifyAndLog_(body)); // peserta

  // admin auth
  if (action === 'adminLogin') return json_(adminLogin_(body));

  // admin protected
  if (action === 'enroll')         return json_(enroll_(body, true));
  if (action === 'adminSummary')   return json_(adminSummary_(body));
  if (action === 'adminLogs')      return json_(adminLogs_(body));
  if (action === 'adminExportCsv') return json_(adminExportCsv_(body));

    // admin protected - NEW
  if (action === 'adminUpdateSettings') return json_(adminUpdateSettings_(body));
  if (action === 'adminChangePin')      return json_(adminChangePin_(body));
  if (action === 'adminMaterialsList')  return json_(adminMaterialsList_(body));
  if (action === 'adminMaterialsUpsert')return json_(adminMaterialsUpsert_(body));
  if (action === 'adminMaterialsDelete')return json_(adminMaterialsDelete_(body));

  if (action === 'adminPesertaMeta')   return json_(adminPesertaMeta_(body));
  if (action === 'adminTrainingReport')return json_(adminTrainingReport_(body));
  if (action === 'adminGateReport')    return json_(adminGateReport_(body));
  if (action === 'adminExportXlsx')    return json_(adminExportXlsx_(body));
  if (action === 'adminExportPdf')     return json_(adminExportPdf_(body));

  if (action === 'adminPesertaList')       return json_(adminPesertaList_(body));
  if (action === 'adminPesertaImport')     return json_(adminPesertaImport_(body));
  if (action === 'adminGetPhotoByNik')     return json_(adminGetPhotoByNik_(body));
  if (action === 'adminNameTagSaveEvent')  return json_(adminNameTagSaveEvent_(body));

  if (action === 'trainingMetaPublic') return json_(trainingMetaPublic_(body));
  if (action === 'adminTrainingMetaList')   return json_(adminTrainingMetaList_(body));
  if (action === 'adminTrainingMetaUpsert') return json_(adminTrainingMetaUpsert_(body));
  if (action === 'adminTrainingMetaDelete') return json_(adminTrainingMetaDelete_(body));

  if (action === 'adminGeofenceList')   return json_(adminGeofenceList_(body));
  if (action === 'adminGeofenceUpsert') return json_(adminGeofenceUpsert_(body));
  if (action === 'adminGeofenceDelete') return json_(adminGeofenceDelete_(body));

  // ✅ Public (tanpa autentikasi)
  if (action === 'geofence.list') return json_(geofenceList_(body));
  if (action === 'live.ping')     return json_(livePing_(body));
  if (action === 'live.list')     return json_(liveList_(body));

  return json_({ ok:false, error:'Unknown action: ' + action });
}

// include yang aman: support nama dengan/ tanpa .html
function include_(name) {
  const candidates = [];
  const n = String(name || '').trim();
  if (!n) return '';

  // coba persis
  candidates.push(n);

  // kalau tidak ada .html, tambahkan
  if (!n.endsWith('.html')) candidates.push(n + '.html');

  // fallback kalau user menulis "style.html" tapi mau "style" (jarang)
  if (n.endsWith('.html')) candidates.push(n.replace(/\.html$/i, ''));

  for (const c of candidates) {
    try {
      return HtmlService.createHtmlOutputFromFile(c).getContent();
    } catch (e) {
      // lanjut coba kandidat lain
    }
  }

  // kalau semua gagal, keluarkan komentar HTML agar mudah dideteksi
  return `/* include_ failed: ${n} */`;
}

function setup(){
  return setAdminPin_('admin123'); // ganti PIN Anda
}

function doPost(e) {
  try {
    // 1) default ambil dari form field (paling aman untuk CORS)
    let body = {};
    const p = (e && e.parameter) ? e.parameter : {};

    // action bisa langsung dari parameter
    if (p.action) body.action = p.action;

    // payload (JSON string) dari parameter
    if (p.payload) {
      try { body = { ...body, ...JSON.parse(p.payload) }; } catch (err) {}
    }

    // 2) fallback: jika memang dikirim sebagai JSON (application/json)
    if ((!body.action) && e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) {}
    }

    const action = body.action;
    if (!action) return json_({ ok:false, error:'Missing action' });

    // public
    if (action === 'config') {
      const cfg = getDynamicConfig_();
      return json_({
        ok: true,
        geofence: cfg.geofence,
        threshold: cfg.threshold,
        liveness: cfg.liveness,
        device_detect: cfg.device_detect,

        // ✅ tambahan utk NameTag
      nametag: cfg.nametag,
      nametag_layouts: (cfg.nametag && cfg.nametag.layouts) ? cfg.nametag.layouts : {},
      nametag_slider_bounds: (cfg.nametag && cfg.nametag.slider_bounds) ? cfg.nametag.slider_bounds : {}
      });
    }
    if (action === 'materialsSuggest') return json_(materialsSuggest_(body));
    if (action === 'verifyAndLog') return json_(verifyAndLog_(body)); // peserta

    // admin auth
    if (action === 'adminLogin') return json_(adminLogin_(body));

    // admin protected
    if (action === 'enroll')         return json_(enroll_(body, true));
    if (action === 'adminSummary')   return json_(adminSummary_(body));
    if (action === 'adminLogs')      return json_(adminLogs_(body));
    if (action === 'adminExportCsv') return json_(adminExportCsv_(body));

      // admin protected - NEW
    if (action === 'adminUpdateSettings') return json_(adminUpdateSettings_(body));
    if (action === 'adminChangePin')      return json_(adminChangePin_(body));
    if (action === 'adminMaterialsList')  return json_(adminMaterialsList_(body));
    if (action === 'adminMaterialsUpsert')return json_(adminMaterialsUpsert_(body));
    if (action === 'adminMaterialsDelete')return json_(adminMaterialsDelete_(body));

    if (action === 'adminPesertaMeta')   return json_(adminPesertaMeta_(body));
    if (action === 'adminTrainingReport')return json_(adminTrainingReport_(body));
    if (action === 'adminGateReport')    return json_(adminGateReport_(body));
    if (action === 'adminExportXlsx')    return json_(adminExportXlsx_(body));
    if (action === 'adminExportPdf')     return json_(adminExportPdf_(body));

    if (action === 'adminPesertaList')       return json_(adminPesertaList_(body));
    if (action === 'adminPesertaImport')     return json_(adminPesertaImport_(body));
    if (action === 'adminGetPhotoByNik')     return json_(adminGetPhotoByNik_(body));
    if (action === 'adminNameTagSaveEvent')  return json_(adminNameTagSaveEvent_(body));

    if (action === 'trainingMetaPublic') return json_(trainingMetaPublic_(body));
    if (action === 'adminTrainingMetaList')   return json_(adminTrainingMetaList_(body));
    if (action === 'adminTrainingMetaUpsert') return json_(adminTrainingMetaUpsert_(body));
    if (action === 'adminTrainingMetaDelete') return json_(adminTrainingMetaDelete_(body));

    if (action === 'adminGeofenceList')   return json_(adminGeofenceList_(body));
    if (action === 'adminGeofenceUpsert') return json_(adminGeofenceUpsert_(body));
    if (action === 'adminGeofenceDelete') return json_(adminGeofenceDelete_(body));

  // ✅ Public (tanpa autentikasi)
  if (action === 'geofence.list') return json_(geofenceList_(body));
  if (action === 'live.ping')     return json_(livePing_(body));
  if (action === 'live.list')     return json_(liveList_(body));

    return json_({ ok:false, error:'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}

/* =========================
   ADMIN: SET PIN (sekali)
   =========================
   Jalankan manual di editor Apps Script:
   setAdminPin_('123456');
*/
function setAdminPin_(pinPlain){
  const hash = sha256_(String(pinPlain));
  PROP.setProperty(ADMIN_PIN_HASH_KEY, hash);
  return 'OK PIN SET';
}

function adminLogin_(body){
  const pin = String(body.pin || '');
  const pinHash = getAdminPinHash_();
  if (!pinHash) return { ok:false, error:'Admin PIN belum diset. Jalankan setAdminPin_(...) di Apps Script.' };

  if (sha256_(pin) !== pinHash) return { ok:false, error:'PIN salah' };

  const rawToken = Utilities.getUuid() + '|' + Date.now();
  const tokenHash = sha256_(rawToken);

  const exp = Date.now() + TOKEN_TTL_MIN * 60 * 1000;

  // ✅ simpan multi token (tokenHash -> exp)
  const key = ADMIN_TOKEN_KEY;
  let store = {};
  try { store = JSON.parse(PROP.getProperty(key) || '{}') || {}; } catch(e){ store = {}; }

  // bersihkan token expired
  const now = Date.now();
  Object.keys(store).forEach(h=>{
    if (Number(store[h] || 0) < now) delete store[h];
  });

  store[tokenHash] = exp;
  PROP.setProperty(key, JSON.stringify(store));

  return { ok:true, token: rawToken, exp };
}

function requireAdmin_(body){
  const tok = String(body.admin_token || '');
  if (!tok) throw new Error('Admin token missing');

  const raw = PROP.getProperty(ADMIN_TOKEN_KEY);
  if (!raw) throw new Error('Admin belum login');

  let store = {};
  try { store = JSON.parse(raw) || {}; } catch(e){ store = {}; }

  const now = Date.now();

  // bersihkan token expired (biar store tidak membesar)
  Object.keys(store).forEach(h=>{
    if (Number(store[h] || 0) < now) delete store[h];
  });
  PROP.setProperty(ADMIN_TOKEN_KEY, JSON.stringify(store));

  const h = sha256_(tok);
  const exp = Number(store[h] || 0);

  if (!exp) throw new Error('Token admin tidak valid');
  if (now > exp) throw new Error('Sesi admin habis. Login ulang.');
}

function getAdminPinHash_(){
  // prioritas ScriptProperties
  const p = PROP.getProperty(ADMIN_PIN_HASH_KEY);
  if (p) return p;

  // fallback: ambil dari settings sheet
  const s = getSetting_('admin_pin_hash');
  return s || '';
}

function adminChangePin_(body){
  requireAdmin_(body);

  const oldPin = String(body.old_pin || '');
  const newPin = String(body.new_pin || '');

  if (newPin.length < 4) return { ok:false, error:'PIN baru minimal 4 digit/karakter.' };

  const pinHash = getAdminPinHash_();
  if (!pinHash) return { ok:false, error:'Admin PIN belum diset. Jalankan setup() atau set PIN sekali.' };

  if (sha256_(oldPin) !== pinHash) return { ok:false, error:'PIN lama salah.' };

  const newHash = sha256_(newPin);

  // ✅ Simpan ke ScriptProperties (prioritas)
  PROP.setProperty(ADMIN_PIN_HASH_KEY, newHash);

  // ✅ Simpan juga ke settings sheet (fallback)
  try { upsertSetting_('admin_pin_hash', newHash, 'admin'); } catch(e){}

  return { ok:true, message:'PIN berhasil diperbarui.' };
}

/* =========================
   ENROLL (ADMIN ONLY)
   - Multi-shot descriptor average
   - Simpan foto master ke Drive
   ========================= */
function enroll_(body, mustAdmin){
  if (mustAdmin) requireAdmin_(body);

  const nik = String(body.nik || '').trim();
  const nama = String(body.nama || '').trim();
  const biodata = body.biodata || {};
  const descriptorAvg = body.descriptor_avg || null; // array 128
  const photoBase64 = String(body.photo_base64 || '');

  if (!nik || !nama) return { ok:false, error:'NIK & Nama wajib' };
  if (!descriptorAvg || !Array.isArray(descriptorAvg)) return { ok:false, error:'Descriptor avg tidak valid' };
  if (!photoBase64.startsWith('data:image/')) return { ok:false, error:'Foto base64 tidak valid' };

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_USERS) || ss.insertSheet(SHEET_USERS);
  ensureUsersHeader_(sh);

  const values = sh.getDataRange().getValues();
  const header = values[0];
  const rows = values.slice(1);

  const idxNik = header.indexOf('nik');
  const idxCreated = header.indexOf('created_at');

  let rowIndex = -1;
  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxNik]).trim() === nik){ rowIndex = i+2; break; }
  }

  const now = new Date();
  const fileId = saveFacePhoto_(nik, nama, photoBase64);

  const rec = {
    nik, nama,
    biodata_json: JSON.stringify(biodata),
    face_descriptor_json: JSON.stringify(descriptorAvg),
    photo_file_id: fileId,
    device_id: '', // belum di-bind
    created_at: now,
    updated_at: now
  };

  if (rowIndex === -1){
    sh.appendRow([
      rec.nik, rec.nama, rec.biodata_json, rec.face_descriptor_json,
      rec.photo_file_id, rec.device_id, rec.created_at, rec.updated_at
    ]);
  } else {
    const created = sh.getRange(rowIndex, idxCreated+1).getValue() || rec.created_at;
    sh.getRange(rowIndex, 1, 1, 8).setValues([[
      rec.nik, rec.nama, rec.biodata_json, rec.face_descriptor_json,
      rec.photo_file_id, rec.device_id, created, rec.updated_at
    ]]);
  }

  return { ok:true, nik, nama, photo_file_id:fileId };
}

function ensureUsersHeader_(sh){
  const expected = ['nik','nama','biodata_json','face_descriptor_json','photo_file_id','device_id','created_at','updated_at'];
  const header = sh.getRange(1,1,1,expected.length).getValues()[0];
  const empty = header.join('').trim() === '';
  if (empty) sh.getRange(1,1,1,expected.length).setValues([expected]);
}

function ensureAttHeader_(sh){
  const expected = ['timestamp','nik','nama','mode','training_type','activity','material','gate_reason','gate_direction','device_id','lat','lng','accuracy_m','distance_m','liveness','status'];
  const header = sh.getRange(1,1,1,expected.length).getValues()[0];
  const empty = header.join('').trim() === '';
  if (empty) sh.getRange(1,1,1,expected.length).setValues([expected]);
}

/* =========================
   SETTINGS (dynamic config)
   ========================= */
function ensureSettingsHeader_(sh){
  const expected = ['key','value','updated_at','updated_by'];
  const header = sh.getRange(1,1,1,expected.length).getValues()[0];
  const empty = header.join('').trim() === '';
  if (empty) sh.getRange(1,1,1,expected.length).setValues([expected]);
}

function getSettingsSheet_(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) sh = ss.insertSheet(SHEET_SETTINGS);
  ensureSettingsHeader_(sh);
  return sh;
}

function getSetting_(key){
  const sh = getSettingsSheet_();
  const values = sh.getDataRange().getValues();
  for (let i=1;i<values.length;i++){
    if (String(values[i][0]).trim() === key) return String(values[i][1] ?? '').trim();
  }
  return '';
}

function upsertSetting_(key, value, updatedBy){
  const sh = getSettingsSheet_();
  const values = sh.getDataRange().getValues();
  const now = new Date();
  for (let i=1;i<values.length;i++){
    if (String(values[i][0]).trim() === key){
      sh.getRange(i+1, 2).setValue(String(value));
      sh.getRange(i+1, 3).setValue(now);
      sh.getRange(i+1, 4).setValue(updatedBy || '');
      return;
    }
  }
  sh.appendRow([key, String(value), now, updatedBy || '']);
}

/* =========================================================
   ✅ MULTI GEOFENCE (SERVER - Google Sheet)
   Sheet: geofence_points
   Columns:
   id, name, lat, lng, radius_m, active, sort, updated_at, updated_by
   ========================================================= */

function ensureGeofencePointsHeader_(sh){
  const expected = ['id','name','lat','lng','radius_m','active','sort','updated_at','updated_by'];
  const lastCol = expected.length;

  // jika sheet benar-benar kosong
  if (sh.getLastRow() === 0){
    sh.getRange(1,1,1,lastCol).setValues([expected]);
    return;
  }

  // jika header kosong -> set
  const cur = sh.getRange(1,1,1,lastCol).getValues()[0].map(x=>String(x||'').trim());
  if (cur.join('').trim() === ''){
    sh.getRange(1,1,1,lastCol).setValues([expected]);
    return;
  }

  // jika sudah ada header tapi kolom kurang -> tambahkan di kanan (non destructive)
  const curLower = cur.map(x=>x.toLowerCase());
  const missing = expected.filter(h => !curLower.includes(h));
  if (missing.length){
    sh.getRange(1, sh.getLastColumn()+1, 1, missing.length).setValues([missing]);
  }
}

function getGeofencePointsSheet_(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_GEOFENCE_POINTS);
  if (!sh) sh = ss.insertSheet(SHEET_GEOFENCE_POINTS);
  ensureGeofencePointsHeader_(sh);
  return sh;
}

function readGeofencePoints_(opts){
  opts = opts || {};
  const includeInactive = !!opts.includeInactive;

  const sh = getGeofencePointsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(h=>String(h||'').trim().toLowerCase());
  const rows = values.slice(1);

  const idx = (k)=> header.indexOf(k);

  const out = rows
    .filter(r => String(r[idx('id')]||'').trim())
    .map(r => ({
      id: String(r[idx('id')]||'').trim(),
      name: String(r[idx('name')]||'').trim(),
      lat: Number(r[idx('lat')]),
      lng: Number(r[idx('lng')]),
      radius_m: Number(r[idx('radius_m')]),
      active: String(r[idx('active')]||'TRUE').toUpperCase() !== 'FALSE',
      sort: Number(r[idx('sort')]||0),
      updated_at: r[idx('updated_at')] ? new Date(r[idx('updated_at')]).toISOString() : '',
      updated_by: String(r[idx('updated_by')]||'').trim()
    }))
    .filter(p => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.radius_m) && p.radius_m > 0)
    .filter(p => includeInactive ? true : !!p.active);

  // sort
  out.sort((a,b)=> (a.sort-b.sort) || (a.name||'').localeCompare(b.name||''));
  return out;
}

/** admin: list */
function adminGeofenceList_(body){
  requireAdmin_(body);
  const items = readGeofencePoints_({ includeInactive:true });
  return { ok:true, items };
}

/** admin: upsert
 * payload: { admin_token, id?, name, lat, lng, radius_m, active, sort }
 */
function adminGeofenceUpsert_(body){
  requireAdmin_(body);

  let id = String(body.id || '').trim();
  const name = String(body.name || '').trim() || 'Titik';
  const lat  = Number(body.lat);
  const lng  = Number(body.lng);
  const radius_m = Number(body.radius_m || 50);
  const active = (body.active === false || String(body.active).toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';
  const sort = Number(body.sort || 0);

  if (!isFinite(lat) || !isFinite(lng)) return { ok:false, error:'Lat/Lng tidak valid.' };
  if (!isFinite(radius_m) || radius_m <= 0) return { ok:false, error:'Radius harus > 0.' };

  const sh = getGeofencePointsSheet_();
  const values = sh.getDataRange().getValues();
  const header = values[0].map(h=>String(h||'').trim().toLowerCase());
  const rows = values.slice(1);
  const idxId = header.indexOf('id');

  const now = new Date();
  if (!id) id = 'GF_' + Utilities.getUuid().slice(0,8);

  let rowIndex = -1;
  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxId]||'').trim() === id){
      rowIndex = i+2;
      break;
    }
  }

  const rec = [id, name, lat, lng, radius_m, active, sort, now, 'admin'];

  if (rowIndex === -1){
    sh.appendRow(rec);
  } else {
    // non destructive: set kolom 1..9 sesuai header default
    sh.getRange(rowIndex, 1, 1, 9).setValues([rec]);
  }

  return { ok:true, id, name, lat, lng, radius_m, active:(active==='TRUE'), sort };
}

/** admin: delete */
function adminGeofenceDelete_(body){
  requireAdmin_(body);

  const id = String(body.id || '').trim();
  if (!id) return { ok:false, error:'ID kosong.' };

  const sh = getGeofencePointsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:false, error:'Data kosong.' };

  const header = values[0].map(h=>String(h||'').trim().toLowerCase());
  const rows = values.slice(1);
  const idxId = header.indexOf('id');

  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxId]||'').trim() === id){
      sh.deleteRow(i+2);
      return { ok:true, message:'Terhapus.' };
    }
  }
  return { ok:false, error:'Tidak ditemukan.' };
}

/* =========================================================
   ✅ GEOFENCE CHECK (NEAREST ACTIVE POINT)
   - fallback: gunakan single center+radius dari cfg.geofence jika points kosong
   ========================================================= */

function geofenceCheck_(cfg, lat, lng){
  const points = (cfg && Array.isArray(cfg.geofence_points)) ? cfg.geofence_points : [];
  let centers = points.filter(p => p && (p.active !== false));

  // fallback ke single config lama
  if (!centers.length){
    const c = cfg?.geofence?.center;
    const r = Number(cfg?.geofence?.radius_m);
    if (c && isFinite(c.lat) && isFinite(c.lng) && isFinite(r) && r > 0){
      centers = [{ id:'server_default', name:'Default (Server)', lat:Number(c.lat), lng:Number(c.lng), radius_m:r, active:true }];
    }
  }

  if (!centers.length){
    return { ok:false, inFence:false, distance_m:NaN, fence_id:'', fence_name:'', fence_radius_m:0, checked:0 };
  }

  let best = null;
  let bestD = Infinity;

  for (const p of centers){
    const d = haversineM_(Number(p.lat), Number(p.lng), Number(lat), Number(lng));
    if (d < bestD){
      bestD = d;
      best = p;
    }
  }

  const rad = Number(best?.radius_m || 0);
  const inFence = (bestD <= rad);

  return {
    ok:true,
    inFence,
    distance_m: bestD,
    fence_id: String(best?.id || ''),
    fence_name: String(best?.name || ''),
    fence_radius_m: rad,
    checked: centers.length
  };
}

function getDynamicConfig_(){
  // fallback ke konstanta lama jika settings kosong
  const lat = Number(getSetting_('geofence_lat') || GEOFENCE_CENTER.lat);
  const lng = Number(getSetting_('geofence_lng') || GEOFENCE_CENTER.lng);
  const rad = Number(getSetting_('geofence_radius_m') || GEOFENCE_RADIUS_M);
  const thr = Number(getSetting_('face_threshold') || FACE_DISTANCE_THRESHOLD);

  // liveness settings
  const liveEnabled = String(getSetting_('liveness_enabled') || 'TRUE').toUpperCase() !== 'FALSE';
  const liveMode = String(getSetting_('liveness_mode') || 'both').toLowerCase(); // blink|turn|both
  const earLow = Number(getSetting_('liveness_ear_low') || 0.18);
  const earHigh = Number(getSetting_('liveness_ear_high') || 0.23);
  const turnThr = Number(getSetting_('liveness_turn_thresh') || 0.18);
  const liveDur = Number(getSetting_('liveness_duration_ms') || 3500);

  const devDetectEnabled = String(getSetting_('device_detect_enabled') || 'TRUE').toUpperCase() !== 'FALSE';

   const NT_DEF_LAYOUTS = {
    "2up":  { "per":2,  "cols":1, "pad":10, "gap":8 },
    "4up":  { "per":4,  "cols":2, "pad":8,  "gap":6 },
    "6up":  { "per":6,  "cols":2, "pad":8,  "gap":5 },
    "8up":  { "per":8,  "cols":2, "pad":8,  "gap":4 },
    "10up": { "per":10, "cols":2, "pad":8,  "gap":3 },
    "12up": { "per":12, "cols":3, "pad":7,  "gap":3 }
  };

  const NT_DEF_BOUNDS = {
    "head_fs":  { "min":6,  "max":32,  "def":14 },
    "head_y":   { "min":-80,"max":60,  "def":0  },
    "sub_fs":   { "min":6,  "max":32,  "def":12 },
    "sub_y":    { "min":-80,"max":100, "def":0  },
    "name_fs":  { "min":6,  "max":100, "def":44 },
    "name_y":   { "min":-80,"max":80,  "def":0  },
    "photo_s":  { "min":50, "max":300, "def":160 },
    "photo_y":  { "min":-80,"max":80,  "def":0  }
  };

  let ntLayouts = NT_DEF_LAYOUTS;
  let ntBounds  = NT_DEF_BOUNDS;

  try{
    const rawL = String(getSetting_('nametag_layouts') || '').trim();
    if (rawL) ntLayouts = JSON.parse(rawL);
  }catch(e){ ntLayouts = NT_DEF_LAYOUTS; }

  try{
    const rawB = String(getSetting_('nametag_slider_bounds') || '').trim();
    if (rawB) ntBounds = JSON.parse(rawB);
  }catch(e){ ntBounds = NT_DEF_BOUNDS; }

  const gfPoints = readGeofencePoints_({ includeInactive:false });

    return {
    geofence: { center:{ lat, lng }, radius_m: rad },
    threshold: thr,
    geofence_points: gfPoints,
    liveness: {
      enabled: liveEnabled,
      mode: liveMode,
      ear_low: earLow,
      ear_high: earHigh,
      turn_thresh: turnThr,
      duration_ms: liveDur
    },
    device_detect: { enabled: devDetectEnabled },

    // ✅ tambahan
    nametag: {
      layouts: ntLayouts,
      slider_bounds: ntBounds
    }
  };
}

/* =========================
   ANTI DUPLICATE HELPERS
   Hash: nik + tanggal + jam(±1min) + device_id
   - CacheService dipakai supaya cepat & auto-expire
   ========================= */

function fmtDate_(d, tz, pat){
  return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), pat);
}

function minuteSlot_(d){
  // slot menit: yyyy-MM-dd|HH:mm
  const tz = Session.getScriptTimeZone();
  return fmtDate_(d, tz, "yyyy-MM-dd|HH:mm");
}

function addMinutes_(d, mins){
  return new Date(d.getTime() + (Number(mins||0) * 60000));
}

function dedupKey_(nik, minuteSlot, deviceId){
  // Hash stable: nik|slot|deviceId  (slot sudah mengandung tanggal+HH:mm)
  const raw = `${String(nik||'').trim()}|${String(minuteSlot||'')}|${String(deviceId||'').trim()}`;
  return 'DEDUP_' + sha256_(raw);
}

function dedupCheckAndMark_(nik, deviceId, nowDate){
  const now = nowDate || new Date();
  const cache = CacheService.getScriptCache();

  // cek slot menit: -1, 0, +1 (±1 menit)
  const slots = [];
  for (let i = -DEDUP_WINDOW_MIN; i <= DEDUP_WINDOW_MIN; i++){
    slots.push(minuteSlot_(addMinutes_(now, i)));
  }

  // 1) check dulu apakah ada yang sudah pernah diset
  for (const slot of slots){
    const k = dedupKey_(nik, slot, deviceId);
    const hit = cache.get(k);
    if (hit){
      return { ok:false, status:'DUPLICATE_ATTEMPT', slot, key:k };
    }
  }

  // 2) kalau belum ada → set untuk slot menit saat ini (cukup satu)
  const currentSlot = minuteSlot_(now);
  const keyNow = dedupKey_(nik, currentSlot, deviceId);
  cache.put(keyNow, '1', DEDUP_TTL_SEC);

  return { ok:true, status:'DEDUP_OK', slot: currentSlot, key:keyNow };
}

/* =========================
   VERIFY + LOG (PESERTA)
   - liveness harus OK (dari client)
   - multi-shot avg descriptor
   - geofence
   - device binding:
       jika user.device_id kosong -> bind ke device_id pertama (setelah face match)
       jika sudah terisi -> harus sama
   ========================= */
function verifyAndLog_(body){
  const mode = String(body.mode || 'training');
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy_m || 0);

  const deviceId = String(body.device_id || '').trim();
  const liveness = body.liveness || null; // { ok:true, type:'blink'|'turn', info:{...} }

  const descriptorAvg = body.descriptor_avg;
  if (!Array.isArray(descriptorAvg)) return { ok:false, error:'Descriptor avg tidak valid' };
  if (!isFinite(lat) || !isFinite(lng)) return { ok:false, error:'Lokasi tidak valid' };
  if (!deviceId) return { ok:false, error:'Device ID missing' };
  const cfg = getDynamicConfig_();
  const liveCfg = cfg.liveness || { enabled:true, mode:'both' };

  // jika liveness dimatikan -> boleh lewat walau null
  if (liveCfg.enabled){
    if (!liveness || liveness.ok !== true) {
      logAttendance_({
        nik:'', nama:'',
        mode, training_type:'', activity:'', material:'',
        gate_reason:'', gate_direction:'',
        device_id: deviceId,
        lat, lng, accuracy_m:accuracy, distance_m: distanceM_(lat,lng),
        liveness: JSON.stringify(liveness || {}),
        status:'LIVENESS_FAIL'
      });
      return { ok:false, error:'Liveness check gagal. Coba lagi.', status:'LIVENESS_FAIL' };
    }

    // mode enforcement
    const t = String(liveness.type || '');
    const m = String(liveCfg.mode || 'both').toLowerCase();

    if (m === 'blink' && t !== 'blink') {
      return { ok:false, error:'Liveness harus kedipan (blink).', status:'LIVENESS_MODE_MISMATCH' };
    }
    if (m === 'turn' && t !== 'turn') {
      return { ok:false, error:'Liveness harus gerakan kepala (turn).', status:'LIVENESS_MODE_MISMATCH' };
    }
    // both -> accept blink OR turn
  }

  const gf = geofenceCheck_(cfg, lat, lng);
  const distM = gf.distance_m;
  const inFence = gf.inFence;

  // match face
  const match = bestMatch_(descriptorAvg);
  if (!match.ok){
  const st = String(match.status || 'FACE_NOT_MATCH'); // bisa FACE_AMBIGUOUS
  logAttendance_({
    nik:'', nama:'',
    mode,
    training_type:String(body.training_type||''),
    activity:String(body.activity||''),
    material:String(body.material||''),
    gate_reason:String(body.gate_reason||''),
    gate_direction:String(body.gate_direction||''),
    device_id: deviceId,
    lat, lng, accuracy_m:accuracy, distance_m:distM,
    liveness: JSON.stringify(liveness),
    status: inFence ? st : ('OUT_OF_FENCE_' + st)
  });

  return { ok:false, error:'Wajah tidak dikenali', status: st, inFence, distance_m:distM };
}

  // fence check
  if (!inFence){
    logAttendance_({
      nik:match.nik, nama:match.nama,
      mode,
      training_type:String(body.training_type||''),
      activity:String(body.activity||''),
      material:String(body.material||''),
      gate_reason:String(body.gate_reason||''),
      gate_direction:String(body.gate_direction||''),
      device_id: deviceId,
      lat, lng, accuracy_m:accuracy, distance_m:distM,
      liveness: JSON.stringify(liveness),
      status:'OUT_OF_FENCE'
    });
    return { ok:false, error:'Di luar area presensi', status:'OUT_OF_FENCE', inFence, distance_m:distM, nik:match.nik, nama:match.nama };
  }

    // ✅ device detect policy (ON/OFF)
  const detectEnabled = !!(cfg.device_detect && cfg.device_detect.enabled);

  const devRes = applyDevicePolicy_(match.nik, deviceId, detectEnabled);

  if (!devRes.ok){
    logAttendance_({
      nik:match.nik, nama:match.nama,
      mode,
      training_type:String(body.training_type||''),
      activity:String(body.activity||''),
      material:String(body.material||''),
      gate_reason:String(body.gate_reason||''),
      gate_direction:String(body.gate_direction||''),
      device_id: deviceId,
      lat, lng, accuracy_m:accuracy, distance_m:distM,
      liveness: JSON.stringify(liveness),
      status:'DEVICE_MISMATCH'
    });
    return {
      ok:false,
      error:'Perangkat tidak sesuai (device mismatch). Hubungi admin.',
      status:'DEVICE_MISMATCH',
      nik:match.nik, nama:match.nama
    };
  }

  // ✅ tentukan status sukses berdasarkan mode deteksi
  let okStatus = 'OK';
  if (devRes.boundNow){
    okStatus = detectEnabled ? 'OK_BOUND' : 'OK_BOUND_DEFDEVICE';
  } else if (!detectEnabled){
    okStatus = devRes.matchDefault ? 'OK_DEFDEVICE' : 'OK_ALTDEVICE';
  } else {
    okStatus = 'OK';
  }

    // =========================================================
  // ✅ ANTI-DUPLICATE BACKEND (hash: nik + tanggal + HH:mm ±1 + device_id)
  // - Dipanggil setelah semua validasi sukses (face + fence + device)
  // =========================================================
  const nowTs = new Date();
  const dedup = dedupCheckAndMark_(match.nik, deviceId, nowTs);
  if (!dedup.ok){
    // log duplicate attempt (optional tapi bagus untuk audit)
    logAttendance_({
      nik:match.nik, nama:match.nama,
      mode,
      training_type:String(body.training_type||''),
      activity:String(body.activity||''),
      material:String(body.material||''),
      gate_reason:String(body.gate_reason||''),
      gate_direction:String(body.gate_direction||''),
      device_id: deviceId,
      lat, lng, accuracy_m:accuracy, distance_m:distM,
      liveness: JSON.stringify(liveness),
      status:'DUPLICATE_ATTEMPT'
    });

    return {
      ok:false,
      error:'Duplicate attendance attempt blocked',
      status:'DUPLICATE_ATTEMPT',
      nik:match.nik,
      nama:match.nama,
      distance_m: distM
    };
  }

  // log OK
  logAttendance_({
    nik:match.nik, nama:match.nama,
    mode,
    training_type:String(body.training_type||''),
    activity:String(body.activity||''),
    material:String(body.material||''),
    gate_reason:String(body.gate_reason||''),
    gate_direction:String(body.gate_direction||''),
    device_id: deviceId,
    lat, lng, accuracy_m:accuracy, distance_m:distM,
    liveness: JSON.stringify(liveness),
    status: okStatus
  });

  return {
    ok:true,
    nik: match.nik,
    nama: match.nama,
    face_distance: match.distance,
    inFence,
    distance_m: distM,

    // ✅ info titik terdekat
    fence_id: gf.fence_id,
    fence_name: gf.fence_name,
    fence_radius_m: gf.fence_radius_m,

    device_bound: devRes.boundNow ? true : false,

    // ✅ tambahan info untuk UI
    status: okStatus,
    device_detect_enabled: detectEnabled,
    default_device_id: devRes.defaultDeviceId || ''
  };
}

function distanceM_(lat, lng){
  const cfg = getDynamicConfig_();
  const c = cfg.geofence.center;
  return haversineM_(Number(c.lat), Number(c.lng), lat, lng);
}

function enforceDeviceBinding_(nik, deviceId){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) return { ok:false, error:'users sheet missing' };

  const values = sh.getDataRange().getValues();
  const header = values[0];
  const rows = values.slice(1);

  const idxNik = header.indexOf('nik');
  const idxDev = header.indexOf('device_id');
  const idxUpd = header.indexOf('updated_at');

  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxNik]).trim() === nik){
      const rowIndex = i + 2;
      const existing = String(rows[i][idxDev] || '').trim();
      if (!existing){
        // bind pertama kali
        sh.getRange(rowIndex, idxDev+1).setValue(deviceId);
        sh.getRange(rowIndex, idxUpd+1).setValue(new Date());
        return { ok:true, boundNow:true };
      }
      if (existing === deviceId) return { ok:true, boundNow:false };
      return { ok:false, error:'device mismatch' };
    }
  }
  return { ok:false, error:'nik not found' };
}

/**
 * applyDevicePolicy_(nik, deviceId, detectEnabled)
 * - jika user belum punya device default -> bind (selalu) (default device ditetapkan)
 * - jika sudah ada:
 *    - detectEnabled = TRUE  -> wajib sama, kalau beda => ok:false
 *    - detectEnabled = FALSE -> boleh beda, return ok:true + info matchDefault
 */
function applyDevicePolicy_(nik, deviceId, detectEnabled){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) return { ok:false, error:'users sheet missing' };

  const values = sh.getDataRange().getValues();
  const header = values[0];
  const rows = values.slice(1);

  const idxNik = header.indexOf('nik');
  const idxDev = header.indexOf('device_id');
  const idxUpd = header.indexOf('updated_at');

  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxNik]).trim() === nik){
      const rowIndex = i + 2;
      const existing = String(rows[i][idxDev] || '').trim();

      // belum ada default device => bind pertama kali (selalu)
      if (!existing){
        sh.getRange(rowIndex, idxDev+1).setValue(deviceId);
        sh.getRange(rowIndex, idxUpd+1).setValue(new Date());
        return { ok:true, boundNow:true, defaultDeviceId: deviceId, matchDefault:true };
      }

      // sudah ada default device
      const matchDefault = (existing === deviceId);

      if (detectEnabled){
        if (matchDefault) return { ok:true, boundNow:false, defaultDeviceId: existing, matchDefault:true };
        return { ok:false, error:'device mismatch', defaultDeviceId: existing, matchDefault:false };
      }

      // detectEnabled = FALSE => boleh beda
      return { ok:true, boundNow:false, defaultDeviceId: existing, matchDefault };
    }
  }

  return { ok:false, error:'nik not found' };
}

function bestMatch_(probeDescriptor){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) return { ok:false, error:'Sheet users tidak ada' };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:false, error:'Data users kosong' };

  const header = values[0];
  const rows = values.slice(1);

  const idxNik = header.indexOf('nik');
  const idxNama = header.indexOf('nama');
  const idxDesc = header.indexOf('face_descriptor_json');

  // === konfigurasi ketat ===
  const cfg = getDynamicConfig_();
  const thr = Number(cfg.threshold);          // threshold utama (misal 0.45)
  const GAP_MIN = Number(getSetting_('face_gap_min') || 0.08);
  // GAP_MIN: selisih minimal antara secondBest dan best.
  // 0.06–0.12 umum. Lebih besar = lebih ketat.

  let best = { distance: Infinity, nik:'', nama:'' };
  let second = { distance: Infinity, nik:'', nama:'' };

  for (const r of rows){
    const raw = r[idxDesc];
    if (!raw) continue;

    let ref;
    try { ref = JSON.parse(raw); } catch(e){ continue; }
    if (!Array.isArray(ref) || ref.length !== probeDescriptor.length) continue;

    const d = euclidean_(probeDescriptor, ref);

    if (d < best.distance){
      second = best;
      best = { distance:d, nik:String(r[idxNik]||''), nama:String(r[idxNama]||'') };
    } else if (d < second.distance){
      second = { distance:d, nik:String(r[idxNik]||''), nama:String(r[idxNama]||'') };
    }
  }

  // tidak ada kandidat valid
  if (!isFinite(best.distance) || !best.nik){
    return { ok:false, error:'No match', best_distance: best.distance };
  }

  // 1) threshold utama
  if (!(best.distance <= thr)){
    return { ok:false, error:'No match', best_distance: best.distance, threshold: thr };
  }

  // 2) ambiguity check (wajib beda cukup jauh dari kandidat kedua)
  // jika second tidak ada (Infinity) -> aman
  const gap = (isFinite(second.distance) ? (second.distance - best.distance) : 999);

  if (gap < GAP_MIN){
    // terlalu ambigu -> tolak agar orang yang mirip tidak "nyangkut"
    return {
      ok:false,
      error:'Ambiguous match',
      status:'FACE_AMBIGUOUS',
      best_distance: best.distance,
      second_distance: second.distance,
      gap,
      gap_min: GAP_MIN
    };
  }

  return {
    ok:true,
    nik: best.nik,
    nama: best.nama,
    distance: best.distance,
    // info tambahan (opsional)
    second_distance: second.distance,
    gap
  };
}

function logAttendance_(rec){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_ATT);
  if (!sh) sh = ss.insertSheet(SHEET_ATT);

  ensureAttHeader_(sh);

  sh.appendRow([
    new Date(),
    rec.nik || '',
    rec.nama || '',
    rec.mode || '',
    rec.training_type || '',
    rec.activity || '',
    rec.material || '',
    rec.gate_reason || '',
    rec.gate_direction || '',
    rec.device_id || '',
    rec.lat || '',
    rec.lng || '',
    rec.accuracy_m || '',
    rec.distance_m || '',
    rec.liveness || '',
    rec.status || ''
  ]);
}

/* =========================
   ADMIN: REKAP + LOG + EXPORT
   ========================= */
function adminSummary_(body){
  requireAdmin_(body);

  const { start, end } = parseRange_(body);
  const data = readAttendance_(start, end);

  // rekap ringkas
  const byStatus = {};
  const byActivity = {};
  let total = 0;

  for (const r of data.rows){
    total++;
    const status = r.status || '(blank)';
    byStatus[status] = (byStatus[status]||0) + 1;

    const act = (r.mode === 'training' ? (r.activity||'(no activity)') : ('GATE:'+(r.gate_direction||''))) ;
    byActivity[act] = (byActivity[act]||0) + 1;
  }

  return { ok:true, range:{start, end}, total, byStatus, byActivity };
}

function adminLogs_(body){
  requireAdmin_(body);

  const { start, end } = parseRange_(body);
  const limit = Math.min(Number(body.limit||200), 2000);

  const data = readAttendance_(start, end);
  const rows = data.rows.slice(-limit).reverse(); // terbaru dulu

  return { ok:true, range:{start,end}, rows };
}

function adminExportCsv_(body){
  requireAdmin_(body);

  const { start, end } = parseRange_(body);
  const data = readAttendance_(start, end);

  const header = data.header;
  const lines = [ header.join(',') ];
  for (const r of data.raw){
    lines.push(r.map(v => csvEscape_(v)).join(','));
  }

  const csv = lines.join('\n');
  return { ok:true, filename:`attendance_${start}_${end}.csv`, csv };
}

function readAttendance_(startStr, endStr){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_ATT);
  if (!sh) return { header:[], rows:[], raw:[] };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { header:values[0]||[], rows:[], raw:[] };

  const header = values[0].map(String);
  const idxTs = header.indexOf('timestamp');

  const start = new Date(startStr + 'T00:00:00');
  const end   = new Date(endStr   + 'T23:59:59');

  const raw = [];
  const rows = [];

  for (let i=1;i<values.length;i++){
    const row = values[i];
    const ts = row[idxTs] instanceof Date ? row[idxTs] : new Date(row[idxTs]);
    if (!(ts instanceof Date) || isNaN(ts.getTime())) continue;
    if (ts < start || ts > end) continue;

    raw.push(row);

    rows.push(mapRow_(header, row));
  }
  return { header, rows, raw };
}

/* =========================================================
   ✅ DASHBOARD ADMIN: join peserta + attendance
   Sheet peserta columns (dari file Anda):
   nik,nama,jenis_pelatihan,tahun,lokasi_ojt,unit,region,group
   ========================================================= */

function getPesertaSheet_(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_PESERTA);

  // ✅ auto-create jika belum ada (aman)
  if (!sh){
    sh = ss.insertSheet(SHEET_PESERTA);
  }

  // ✅ pastikan header sesuai template
  ensurePesertaHeader_(sh);

  return sh;
}

function readPeserta_(){
  const sh = getPesertaSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map(String);
  const rows = values.slice(1);

  const idx = (k)=> header.indexOf(k);

  return rows
    .filter(r => String(r[idx('nik')] || '').trim())
    .map(r => ({
      nik: String(r[idx('nik')]||'').trim(),
      nama: String(r[idx('nama')]||'').trim(),
      jenis_pelatihan: String(r[idx('jenis_pelatihan')]||'').trim(),
      tahun: String(r[idx('tahun')]||'').trim(),
      lokasi_ojt: String(r[idx('lokasi_ojt')]||'').trim(),
      unit: String(r[idx('unit')]||'').trim(),     // Estate
      region: String(r[idx('region')]||'').trim(),
      group: String(r[idx('group')]||'').trim()
    }));
}

/* =========================================================
   ✅ DASHBOARD META HELPERS (TrainingType -> Group/Activity/Materi)
   ========================================================= */

function uniqSorted_(arr){
  return Array.from(new Set((arr||[])
    .map(x => String(x||'').trim())
    .filter(x => x)))
    .sort((a,b)=> a.localeCompare(b));
}

function readAttendanceAll_(){
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_ATT);
  if (!sh) return { header:[], rows:[] };

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { header: values[0]||[], rows:[] };

  const header = values[0].map(String);
  const rows = values.slice(1).map(r => mapRow_(header, r)); // pakai mapRow_ Anda (sudah ada)
  return { header, rows };
}

function readActiveMaterials_(){
  // ambil dari sheet materials (active=TRUE)
  try{
    const sh = getMaterialsSheet_();
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    const header = values[0].map(String);
    const rows = values.slice(1);

    const idxName = header.indexOf('name');
    const idxActive = header.indexOf('active');

    return uniqSorted_(
      rows
        .filter(r => String(r[idxName]||'').trim())
        .filter(r => String(r[idxActive]||'TRUE').toUpperCase() === 'TRUE')
        .map(r => String(r[idxName]||'').trim())
    );
  } catch(e){
    return [];
  }
}

function adminPesertaMeta_(body){
  requireAdmin_(body);

  const list = readPeserta_();

  // TRAINING TYPE dari sheet peserta: jenis_pelatihan
  const trainingTypes = uniqSorted_(list.map(x=>x.jenis_pelatihan));
  const groupsAll = uniqSorted_(list.map(x=>x.group));

  // ✅ groups_by_training_type: { "KLP1 AGRO": ["19/2025", ...], ... }
  const groupsByType = {};
  trainingTypes.forEach(tt=>{
    groupsByType[tt] = uniqSorted_(list.filter(x=>x.jenis_pelatihan === tt).map(x=>x.group));
  });

  // Ambil activity & materi dari attendance (biar dashboard mengikuti data real)
  const att = readAttendanceAll_();

  // only training rows yang OK
  const trainRows = (att.rows||[])
    .filter(r => String(r.mode||'') === 'training')
    .filter(r => isOkStatus_(r.status));

  // ✅ activities_by_training_type: { tt: ["Sesi Kelas", "Field Day", ...] }
  const activitiesByType = {};
  trainingTypes.forEach(tt=>{
    activitiesByType[tt] = uniqSorted_(
      trainRows
        .filter(r => String(r.training_type||'').trim() === tt)
        .map(r => String(r.activity||'').trim())
    );
  });

  // fallback activities jika attendance belum ada datanya
  const fallbackActivities = ['Sesi Kelas','Field Day','OJT','Apel','Olahraga','Lainnya'];

  trainingTypes.forEach(tt=>{
    if (!activitiesByType[tt] || !activitiesByType[tt].length){
      activitiesByType[tt] = fallbackActivities.slice();
    }
  });

  // ✅ materials_by_type_activity: { tt: { activity: ["Materi A","Materi B"] } }
  const materialsByTypeAct = {};
  trainingTypes.forEach(tt=>{
    materialsByTypeAct[tt] = {};
    const rowsTT = trainRows.filter(r => String(r.training_type||'').trim() === tt);
    const acts = uniqSorted_(rowsTT.map(r => String(r.activity||'').trim()));
    acts.forEach(act=>{
      materialsByTypeAct[tt][act] = uniqSorted_(
        rowsTT
          .filter(r => String(r.activity||'').trim() === act)
          .map(r => String(r.material||'').trim())
      );
    });
  });

  // master materials (active=TRUE)
  const materialsAll = readActiveMaterials_();

  return {
    ok:true,

    // existing (tetap)
    groups: groupsAll,
    years: uniqSorted_(list.map(x=>x.tahun)),
    jenis_pelatihan: trainingTypes,
    regions: uniqSorted_(list.map(x=>x.region)),
    units: uniqSorted_(list.map(x=>x.unit)),

    // ✅ NEW untuk filter bertingkat dashboard
    groups_by_training_type: groupsByType,
    activities_by_training_type: activitiesByType,
    materials_by_type_activity: materialsByTypeAct,
    materials_all: materialsAll
  };
}

function isOkStatus_(s){
  return /^OK/i.test(String(s||'').trim());
}

function dayNameId_(d){
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  return days[d.getDay()] || '';
}

function fmtTime_(d){
  const tz = Session.getScriptTimeZone();
  return Utilities.formatDate(d, tz, 'HH:mm:ss');
}

function fmtDateLongId_(d){
  const tz = Session.getScriptTimeZone();
  // dd MMMM yyyy (pakai format standar; nama bulan mengikuti locale Google)
  return Utilities.formatDate(d, tz, 'dd MMMM yyyy');
}

function parseISODate_(s){
  // input: yyyy-MM-dd
  const m = String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Format tanggal harus yyyy-MM-dd');
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
}

/* ---------- REPORT: DAFTAR HADIR TRAINING ---------- */
function adminTrainingReport_(body){
  requireAdmin_(body);

  const dateStr = String(body.date||'').trim();
  const group = String(body.group||'').trim();
  const trainingType = String(body.training_type||'').trim();
  const activity = String(body.activity||'').trim();
  const material = String(body.material||'').trim();
  const location = String(body.location||'Seriang Training Center').trim();

  if (!dateStr || !group || !trainingType || !activity){
    return { ok:false, error:'Wajib: date, group, training_type, activity' };
  }

  const d0 = parseISODate_(dateStr);

  // roster by group
  const roster = readPeserta_().filter(p => p.group === group);

  // ambil attendance hari itu saja
  const data = readAttendance_(dateStr, dateStr);

  // filter training rows
  const hits = data.rows
    .filter(r => String(r.mode||'') === 'training')
    .filter(r => String(r.training_type||'').trim() === trainingType)
    .filter(r => String(r.activity||'').trim() === activity)
    .filter(r => material ? (String(r.material||'').trim() === material) : true)
    .filter(r => isOkStatus_(r.status));

  // map nik -> earliest timestamp
  const earliest = {};
  hits.forEach(r=>{
    const nik = String(r.nik||'').trim();
    const ts = new Date(r.timestamp);
    if (!nik || isNaN(ts.getTime())) return;
    if (!earliest[nik] || ts.getTime() < earliest[nik].getTime()) earliest[nik] = ts;
  });

  const rows = roster.map(p=>{
    const ts = earliest[p.nik] ? fmtTime_(earliest[p.nik]) : '';
    return {
      nik: p.nik,
      nama: p.nama,
      estate: p.unit,
      region: p.region,
      timestamp: ts
    };
  });

  const hadir = rows.filter(x=>x.timestamp).length;
  const total = rows.length;
  const absen = total - hadir;

  return {
    ok:true,
    meta:{
      date: dateStr,
      day: dayNameId_(d0),
      date_long: fmtDateLongId_(d0),
      group,
      training_type: trainingType,
      activity,
      material,
      location
    },
    stats:{ total, hadir, absen },
    rows
  };
}

/* ---------- REPORT: MOBILITAS GATE ---------- */
function adminGateReport_(body){
  requireAdmin_(body);

  const start = String(body.start||'').trim();
  const end = String(body.end||'').trim();
  const view = String(body.view||'daily').trim(); // daily | person
  const gateReasonFilter = String(body.gate_reason||'').trim();
  const nik = String(body.nik||'').trim();
  const group = String(body.group||'').trim();

  if (!start || !end) return { ok:false, error:'Wajib: start, end' };
  if (view === 'person' && !nik) return { ok:false, error:'Mode person membutuhkan NIK' };

  const rosterAll = readPeserta_();
  const rosterByNik = {};
  rosterAll.forEach(p=> rosterByNik[p.nik] = p);

  const data = readAttendance_(start, end);

  const gateRows = data.rows
    .filter(r => String(r.mode||'') === 'gate')
    .filter(r => isOkStatus_(r.status))
    .filter(r => gateReasonFilter ? String(r.gate_reason||'').trim() === gateReasonFilter : true)
    .filter(r => group ? ((rosterByNik[String(r.nik||'').trim()]||{}).group === group) : true);

  // helper date key
  const tz = Session.getScriptTimeZone();
  const dateKey = (iso)=> Utilities.formatDate(new Date(iso), tz, 'yyyy-MM-dd');

  if (view === 'person'){
    const rowsNik = gateRows.filter(r => String(r.nik||'').trim() === nik);

    // group by day + reason (optional)
    const map = {}; // key: date|reason -> {in:[], out:[]}
    rowsNik.forEach(r=>{
      const d = dateKey(r.timestamp);
      const reason = String(r.gate_reason||'').trim();
      const key = d + '|' + reason;
      map[key] = map[key] || { date:d, gate_reason:reason, in:[], out:[] };
      const dir = String(r.gate_direction||'').trim().toUpperCase();
      const t = fmtTime_(new Date(r.timestamp));
      if (dir === 'IN') map[key].in.push(t);
      else if (dir === 'OUT') map[key].out.push(t);
    });

    const p = rosterByNik[nik] || { nik, nama:'' };

    const out = Object.values(map)
      .sort((a,b)=> a.date.localeCompare(b.date))
      .map(x=>({
        date: x.date,
        nik,
        nama: p.nama || '',
        gate_reason: x.gate_reason || '',
        in_times: x.in.join(', '),
        out_times: x.out.join(', '),
        total: (x.in.length + x.out.length)
      }));

    return {
      ok:true,
      summary_text: `Per Peserta: ${nik} • Rows: ${out.length}`,
      rows: out
    };
  }

  // daily summary all peserta
  const agg = {}; // date|reason -> counts
  gateRows.forEach(r=>{
    const d = dateKey(r.timestamp);
    const reason = String(r.gate_reason||'').trim();
    const key = d + '|' + reason;
    agg[key] = agg[key] || { date:d, gate_reason:reason, in_count:0, out_count:0, total:0 };
    const dir = String(r.gate_direction||'').trim().toUpperCase();
    if (dir === 'IN') agg[key].in_count++;
    if (dir === 'OUT') agg[key].out_count++;
    agg[key].total++;
  });

  const out = Object.values(agg)
    .sort((a,b)=> (a.date.localeCompare(b.date) || a.gate_reason.localeCompare(b.gate_reason)));

  return {
    ok:true,
    summary_text: `Rekap Harian • Rows: ${out.length}`,
    rows: out
  };
}

/* =========================================================
   ✅ EXPORT XLSX / PDF (membuat Google Sheet temporary → export)
   ========================================================= */

function exportSpreadsheetBlob_(ssId, fmt, gid){
  const token = ScriptApp.getOAuthToken();

  // ===== XLSX via Google Drive export API (paling stabil) =====
  if (fmt === 'xlsx'){
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ssId)}/export?mimeType=${encodeURIComponent(mime)}`;

    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });

    const code = res.getResponseCode();
    if (code >= 300){
      const txt = res.getContentText() || '';
      throw new Error(`Export XLSX gagal (${code}): ${txt.slice(0, 200)}`);
    }

    return res.getBlob().setName('export.xlsx');
  }

  // ===== PDF via docs.google.com export (support gid + opsi layout) =====
  // Note: ini lebih fleksibel daripada DriveApp.getAs(PDF)
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(ssId)}/export?format=pdf`;

  const params = {
  gid: gid ? String(gid) : '',
  single: gid ? 'true' : 'false',   // ✅ export hanya sheet target jika ada gid
  size: 'A4',
  portrait: 'true',
  fitw: 'true',
  sheetnames: 'false',
  printtitle: 'false',
  pagenumbers: 'false',
  gridlines: 'false',
  fzr: 'false',
  top_margin: '0.50',
  bottom_margin: '0.50',
  left_margin: '0.50',
  right_margin: '0.50'
};

  const query = Object.keys(params)
    .filter(k => params[k] !== '')
    .map(k => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');

  const url = base + '&' + query;

  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code >= 300){
    const txt = res.getContentText() || '';
    throw new Error(`Export PDF gagal (${code}): ${txt.slice(0, 200)}`);
  }

  return res.getBlob().setName('export.pdf');
}


function buildTrainingSheet_(report){
  const meta = report.meta;
  const rows = report.rows || [];

  const ss = SpreadsheetApp.create(`TMP_DAFTAR_HADIR_${meta.date}_${Date.now()}`);
  const sh = ss.getSheets()[0];
  sh.setName('DaftarHadir');

  // Header layout
  sh.getRange('A1:F1').merge().setValue('DAFTAR HADIR KEGIATAN TRAINING CENTER')
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center');

  sh.getRange('A2:F2').merge().setValue(`Jenis Kegiatan: ${meta.activity} • Training: ${meta.training_type} • Batch: ${meta.group}`)
    .setFontWeight('bold');

  sh.getRange('A3:F3').merge().setValue(`Hari/Tanggal: ${meta.day}, ${meta.date_long} • Lokasi: ${meta.location}`);
  sh.getRange('A4:F4').merge().setValue(`Materi: ${meta.material || '-'}`);

  // Table header
  sh.getRange(6,1,1,6).setValues([['No','NIK','Nama Peserta','Estate','Region','Timestamp']])
    .setFontWeight('bold').setBackground('#e5e7eb');

  // Table rows
  const body = rows.map((r,i)=>[i+1, r.nik, r.nama, r.estate||'', r.region||'', r.timestamp||'']);
  if (body.length){
    sh.getRange(7,1,body.length,6).setValues(body);
  }

  // borders
  const lastRow = 7 + Math.max(body.length, 1) - 1;
  sh.getRange(6,1,lastRow-6+1,6).setBorder(true,true,true,true,true,true);

  // signature
  const sigRow = lastRow + 3;
  sh.getRange(sigRow, 2).setValue('TC Head').setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(sigRow, 5).setValue('Instruktur').setFontWeight('bold').setHorizontalAlignment('center');

  sh.getRange(sigRow+4, 2).setValue('(____________________)').setHorizontalAlignment('center');
  sh.getRange(sigRow+4, 5).setValue('(____________________)').setHorizontalAlignment('center');

  // column widths
  sh.setColumnWidths(1,1,50);
  sh.setColumnWidths(2,1,120);
  sh.setColumnWidths(3,1,220);
  sh.setColumnWidths(4,1,120);
  sh.setColumnWidths(5,1,120);
  sh.setColumnWidths(6,1,120);

  return { ssId: ss.getId(), gid: sh.getSheetId() };
}

function buildGateSheet_(report, view, start, end){
  const ss = SpreadsheetApp.create(`TMP_MOBILITAS_${start}_${end}_${Date.now()}`);
  const sh = ss.getSheets()[0];
  sh.setName('Mobilitas');

  sh.getRange('A1:G1').merge().setValue('LAPORAN MOBILITAS PESERTA (GATE)')
    .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center');

  sh.getRange('A2:G2').merge().setValue(`Periode: ${start} s/d ${end} • Mode: ${view === 'person' ? 'Per Peserta' : 'Rekap Harian'}`)
    .setFontWeight('bold');

  let header = [];
  let body = [];

  if (view === 'person'){
    header = ['Tanggal','NIK','Nama','Reason','IN Times','OUT Times','Total'];
    body = (report.rows||[]).map(r=>[
      r.date, r.nik, r.nama, r.gate_reason||'', r.in_times||'', r.out_times||'', r.total||0
    ]);
  } else {
    header = ['Tanggal','Reason','IN','OUT','Total'];
    body = (report.rows||[]).map(r=>[
      r.date, r.gate_reason||'', r.in_count||0, r.out_count||0, r.total||0
    ]);
  }

  const colN = header.length;
  sh.getRange(4,1,1,colN).setValues([header]).setFontWeight('bold').setBackground('#e5e7eb');

  if (body.length){
    sh.getRange(5,1,body.length,colN).setValues(body);
  }

  const lastRow = 5 + Math.max(body.length, 1) - 1;
  sh.getRange(4,1,lastRow-4+1,colN).setBorder(true,true,true,true,true,true);

  // widths
  for (let c=1;c<=colN;c++) sh.setColumnWidth(c, 140);
  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(3, 160);
  if (view === 'person'){
    sh.setColumnWidth(5, 240);
    sh.setColumnWidth(6, 240);
  }

  return { ssId: ss.getId(), gid: sh.getSheetId() };
}

/* =========================================================
   ✅ FIX BLANK EXPORT:
   Pastikan spreadsheet temporary sudah "matang" sebelum export
   ========================================================= */
function finalizeTmpSpreadsheet_(ssId){
  // pastikan semua setValue/setValues/format sudah ditulis
  SpreadsheetApp.flush();

  // kecilkan risiko race condition (Drive belum siap export)
  Utilities.sleep(900);

  // "touch" file Drive agar benar-benar terbaca oleh export endpoint
  // (kadang export terlalu cepat -> hasil kosong)
  try{
    DriveApp.getFileById(ssId).getName();
  } catch(e){
    // fallback tambahan
    Utilities.sleep(600);
  }

  // flush sekali lagi untuk aman
  SpreadsheetApp.flush();
}

function adminExportXlsx_(body){
  requireAdmin_(body);

  const type = String(body.report_type||'').trim(); // training | gate
  if (!type) return { ok:false, error:'report_type required' };

  let tmp = null;
  let filename = '';

  try{
    if (type === 'training'){
      const rep = adminTrainingReport_(body);
      if (!rep.ok) return rep;

      tmp = buildTrainingSheet_(rep);
      filename = `DaftarHadir_${rep.meta.group}_${rep.meta.date}.xlsx`;

    } else if (type === 'gate'){
      const rep = adminGateReport_(body);
      if (!rep.ok) return rep;

      tmp = buildGateSheet_(rep, String(body.view||'daily'), String(body.start||''), String(body.end||''));
      filename = `Mobilitas_${String(body.start)}_${String(body.end)}.xlsx`;

    } else {
      return { ok:false, error:'report_type invalid (training|gate)' };
    }

    // ✅ FIX: pastikan sheet temp sudah tersimpan penuh
    finalizeTmpSpreadsheet_(tmp.ssId);

    const blob = exportSpreadsheetBlob_(tmp.ssId, 'xlsx');
    try { blob.setName(filename); } catch(e){}
    const b64 = Utilities.base64Encode(blob.getBytes());

    try { DriveApp.getFileById(tmp.ssId).setTrashed(true); } catch(e){}

    return {
      ok:true,
      filename,
      mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      b64
    };

  } catch(e){
    if (tmp && tmp.ssId){
      try { DriveApp.getFileById(tmp.ssId).setTrashed(true); } catch(err){}
    }
    return { ok:false, error:String(e && e.message ? e.message : e) };
  }
}

function adminExportPdf_(body){
  requireAdmin_(body);

  const type = String(body.report_type||'').trim(); // training | gate
  if (!type) return { ok:false, error:'report_type required' };

  let tmp = null;
  let filename = '';

  try{
    if (type === 'training'){
      const rep = adminTrainingReport_(body);
      if (!rep.ok) return rep;

      tmp = buildTrainingSheet_(rep);
      filename = `DaftarHadir_${rep.meta.group}_${rep.meta.date}.pdf`;

    } else if (type === 'gate'){
      const rep = adminGateReport_(body);
      if (!rep.ok) return rep;

      tmp = buildGateSheet_(rep, String(body.view||'daily'), String(body.start||''), String(body.end||''));
      filename = `Mobilitas_${String(body.start)}_${String(body.end)}.pdf`;

    } else {
      return { ok:false, error:'report_type invalid (training|gate)' };
    }

    // ✅ FIX: pastikan sheet temp sudah tersimpan penuh
    finalizeTmpSpreadsheet_(tmp.ssId);

    const blob = exportSpreadsheetBlob_(tmp.ssId, 'pdf', tmp.gid);
    try { blob.setName(filename); } catch(e){}
    const b64 = Utilities.base64Encode(blob.getBytes());

    try { DriveApp.getFileById(tmp.ssId).setTrashed(true); } catch(e){}

    return {
      ok:true,
      filename,
      mime:'application/pdf',
      b64
    };

  } catch(e){
    if (tmp && tmp.ssId){
      try { DriveApp.getFileById(tmp.ssId).setTrashed(true); } catch(err){}
    }
    return { ok:false, error:String(e && e.message ? e.message : e) };
  }
}

function mapRow_(header, row){
  const o = {};
  header.forEach((h,i)=> o[h]=row[i]);
  // normalisasi untuk UI
  return {
    timestamp: o.timestamp ? new Date(o.timestamp).toISOString() : '',
    nik: String(o.nik||''),
    nama: String(o.nama||''),
    mode: String(o.mode||''),
    training_type: String(o.training_type||''),
    activity: String(o.activity||''),
    material: String(o.material||''),
    gate_reason: String(o.gate_reason||''),
    gate_direction: String(o.gate_direction||''),
    device_id: String(o.device_id||''),
    lat: o.lat, lng: o.lng,
    accuracy_m: o.accuracy_m,
    distance_m: o.distance_m,
    liveness: String(o.liveness||''),
    status: String(o.status||'')
  };
}

function parseRange_(body){
  // default: hari ini
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const start = String(body.start || today);
  const end   = String(body.end   || today);
  return { start, end };
}

function csvEscape_(v){
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

function adminUpdateSettings_(body){
  requireAdmin_(body);

  const lat = Number(body.geofence_lat);
  const lng = Number(body.geofence_lng);
  const rad = Number(body.geofence_radius_m);
  const thr = Number(body.face_threshold);

  if (!isFinite(lat) || !isFinite(lng)) return { ok:false, error:'Latitude/Longitude tidak valid.' };
  if (!isFinite(rad) || rad <= 0) return { ok:false, error:'Radius harus angka > 0.' };
  if (!isFinite(thr) || thr <= 0) return { ok:false, error:'Face threshold harus angka > 0.' };

  // liveness
  const liveEnabled = (body.liveness_enabled === false || String(body.liveness_enabled).toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';
  const liveMode = String(body.liveness_mode || 'both').toLowerCase(); // blink|turn|both

  const earLow = Number(body.ear_low);
  const earHigh = Number(body.ear_high);
  const turnThr = Number(body.turn_thresh);
  const liveDur = Number(body.liveness_duration_ms);

    // ✅ device detect
  const devDetectEnabled = (body.device_detect_enabled === false || String(body.device_detect_enabled).toUpperCase() === 'FALSE')
    ? 'FALSE' : 'TRUE';

  if (!['blink','turn','both'].includes(liveMode)) return { ok:false, error:'Mode liveness tidak valid.' };
  if (!isFinite(earLow) || earLow <= 0) return { ok:false, error:'EAR Low tidak valid.' };
  if (!isFinite(earHigh) || earHigh <= 0) return { ok:false, error:'EAR High tidak valid.' };
  if (earHigh <= earLow) return { ok:false, error:'EAR High harus > EAR Low.' };
  if (!isFinite(turnThr) || turnThr <= 0) return { ok:false, error:'Turn threshold tidak valid.' };
  if (!isFinite(liveDur) || liveDur < 500) return { ok:false, error:'Durasi liveness minimal 500ms.' };

  upsertSetting_('geofence_lat', lat, 'admin');
  upsertSetting_('geofence_lng', lng, 'admin');
  upsertSetting_('geofence_radius_m', rad, 'admin');
  upsertSetting_('face_threshold', thr, 'admin');

  upsertSetting_('liveness_enabled', liveEnabled, 'admin');
  upsertSetting_('liveness_mode', liveMode, 'admin');
  upsertSetting_('liveness_ear_low', earLow, 'admin');
  upsertSetting_('liveness_ear_high', earHigh, 'admin');
  upsertSetting_('liveness_turn_thresh', turnThr, 'admin');
  upsertSetting_('liveness_duration_ms', liveDur, 'admin');
  
  upsertSetting_('device_detect_enabled', devDetectEnabled, 'admin');

  if (body.nametag_layouts != null){
    let obj = body.nametag_layouts;

    // kalau front-end mengirim string JSON, parse dulu
    if (typeof obj === 'string'){
      try { obj = JSON.parse(obj); } catch(e){ return { ok:false, error:'nametag_layouts JSON tidak valid.' }; }
    }
    if (typeof obj !== 'object') return { ok:false, error:'nametag_layouts harus object.' };

    upsertSetting_('nametag_layouts', JSON.stringify(obj), 'admin');
  }

  if (body.nametag_slider_bounds != null){
    let obj = body.nametag_slider_bounds;

    if (typeof obj === 'string'){
      try { obj = JSON.parse(obj); } catch(e){ return { ok:false, error:'nametag_slider_bounds JSON tidak valid.' }; }
    }
    if (typeof obj !== 'object') return { ok:false, error:'nametag_slider_bounds harus object.' };

    upsertSetting_('nametag_slider_bounds', JSON.stringify(obj), 'admin');
  }

  const cfg = getDynamicConfig_();
  return { ok:true, message:'Settings tersimpan.', cfg };
}

/* =========================================================
   ✅ TRAINING META (Sheet: training_meta)
   Columns: id,kind,name,active,sort,created_at,updated_at
   kind: training_type | activity
   ========================================================= */

function ensureTrainingMetaHeader_(sh){
  const expected = ['id','kind','name','active','sort','created_at','updated_at'];
  const header = sh.getRange(1,1,1,expected.length).getValues()[0];
  const empty = header.join('').trim() === '';
  if (empty) sh.getRange(1,1,1,expected.length).setValues([expected]);
}

function getTrainingMetaSheet_(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_TRAINING_META);
  if (!sh) sh = ss.insertSheet(SHEET_TRAINING_META);
  ensureTrainingMetaHeader_(sh);
  return sh;
}

function readTrainingMetaAll_(){
  const sh = getTrainingMetaSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  const header = values[0].map(String);
  const rows = values.slice(1);
  const idx = (k)=> header.indexOf(k);

  const out = rows
    .filter(r => String(r[idx('id')]||'').trim())
    .map(r => ({
      id: String(r[idx('id')]||'').trim(),
      kind: String(r[idx('kind')]||'').trim(),
      name: String(r[idx('name')]||'').trim(),
      active: String(r[idx('active')]||'TRUE').toUpperCase() === 'TRUE',
      sort: Number(r[idx('sort')]||0),
      created_at: r[idx('created_at')] ? new Date(r[idx('created_at')]).toISOString() : '',
      updated_at: r[idx('updated_at')] ? new Date(r[idx('updated_at')]).toISOString() : ''
    }));

  // sort: sort asc, name asc
  out.sort((a,b)=> (a.sort-b.sort) || a.name.localeCompare(b.name));
  return out;
}

// PUBLIC: hanya yang active
function trainingMetaPublic_(body){
  const all = readTrainingMetaAll_();
  const types = all.filter(x=>x.kind==='training_type' && x.active).map(x=>x.name);
  const acts  = all.filter(x=>x.kind==='activity' && x.active).map(x=>x.name);
  return { ok:true, training_types: types, activities: acts };
}

// ADMIN: list all
function adminTrainingMetaList_(body){
  requireAdmin_(body);
  const items = readTrainingMetaAll_();
  return { ok:true, items };
}

function adminTrainingMetaUpsert_(body){
  requireAdmin_(body);

  let id = String(body.id || '').trim();
  const kind = String(body.kind || '').trim();
  const name = String(body.name || '').trim();
  const active = (body.active === false || String(body.active).toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';
  const sort = Number(body.sort || 0);

  if (!name) return { ok:false, error:'Nama wajib diisi.' };
  if (!['training_type','activity'].includes(kind)) return { ok:false, error:'Kind tidak valid.' };

  const sh = getTrainingMetaSheet_();
  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  const rows = values.slice(1);
  const idxId = header.indexOf('id');

  const now = new Date();
  if (!id) id = 'TM_' + Utilities.getUuid().slice(0,8);

  // find by id
  let rowIndex = -1;
  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxId]||'').trim() === id){
      rowIndex = i+2;
      break;
    }
  }

  const rec = [id, kind, name, active, sort, now, now];

  if (rowIndex === -1){
    sh.appendRow(rec);
  } else {
    // keep created_at
    const created = sh.getRange(rowIndex, 6).getValue() || now; // created_at col=6
    sh.getRange(rowIndex, 1, 1, 7).setValues([[id, kind, name, active, sort, created, now]]);
  }

  return { ok:true, id, kind, name, active:(active==='TRUE'), sort };
}

function adminTrainingMetaDelete_(body){
  requireAdmin_(body);
  const id = String(body.id || '').trim();
  if (!id) return { ok:false, error:'ID kosong.' };

  const sh = getTrainingMetaSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:false, error:'Data kosong.' };

  const header = values[0].map(String);
  const rows = values.slice(1);
  const idxId = header.indexOf('id');

  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxId]||'').trim() === id){
      sh.deleteRow(i+2);
      return { ok:true, message:'Terhapus.' };
    }
  }
  return { ok:false, error:'Tidak ditemukan.' };
}

/* =========================
   MATERIALS (CRUD)
   ========================= */
function ensureMaterialsHeader_(sh){
  const expected = ['id','name','tags','active','created_at','updated_at'];
  const header = sh.getRange(1,1,1,expected.length).getValues()[0];
  const empty = header.join('').trim() === '';
  if (empty) sh.getRange(1,1,1,expected.length).setValues([expected]);
}

function getMaterialsSheet_(){
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_MATERIALS);
  if (!sh) sh = ss.insertSheet(SHEET_MATERIALS);
  ensureMaterialsHeader_(sh);
  return sh;
}

function adminMaterialsList_(body){
  requireAdmin_(body);

  const sh = getMaterialsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:true, items:[] };

  const header = values[0].map(String);
  const rows = values.slice(1);

  const idx = (k)=> header.indexOf(k);
  const out = rows
    .filter(r => String(r[idx('id')]||'').trim())
    .map(r => ({
      id: String(r[idx('id')]||''),
      name: String(r[idx('name')]||''),
      tags: String(r[idx('tags')]||''),
      active: String(r[idx('active')]||'TRUE').toUpperCase() === 'TRUE',
      created_at: r[idx('created_at')] ? new Date(r[idx('created_at')]).toISOString() : '',
      updated_at: r[idx('updated_at')] ? new Date(r[idx('updated_at')]).toISOString() : ''
    }))
    .sort((a,b)=> a.name.localeCompare(b.name));

  return { ok:true, items: out };
}

function adminMaterialsUpsert_(body){
  requireAdmin_(body);

  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim();
  const tags = String(body.tags || '').trim();
  const active = (body.active === false || String(body.active).toUpperCase() === 'FALSE') ? 'FALSE' : 'TRUE';

  if (!name) return { ok:false, error:'Nama materi wajib.' };

  const sh = getMaterialsSheet_();
  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  const rows = values.slice(1);
  const idxId = header.indexOf('id');
  const idxName = header.indexOf('name');
  const idxTags = header.indexOf('tags');
  const idxActive = header.indexOf('active');
  const idxCreated = header.indexOf('created_at');
  const idxUpdated = header.indexOf('updated_at');

  const now = new Date();

  // kalau id kosong -> buat baru
  let materialId = id || ('MAT_' + Utilities.getUuid().slice(0,8));

  // cek existing by id
  let rowIndex = -1;
  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxId]).trim() === materialId){
      rowIndex = i+2;
      break;
    }
  }

  if (rowIndex === -1){
    sh.appendRow([materialId, name, tags, active, now, now]);
  } else {
    const created = sh.getRange(rowIndex, idxCreated+1).getValue() || now;
    sh.getRange(rowIndex, 1, 1, 6).setValues([[
      materialId,
      name,
      tags,
      active,
      created,
      now
    ]]);
  }

  return { ok:true, id: materialId, name, tags, active: (active==='TRUE') };
}

function adminMaterialsDelete_(body){
  requireAdmin_(body);

  const id = String(body.id || '').trim();
  if (!id) return { ok:false, error:'ID materi kosong.' };

  const sh = getMaterialsSheet_();
  const values = sh.getDataRange().getValues();
  const header = values[0].map(String);
  const rows = values.slice(1);
  const idxId = header.indexOf('id');

  for (let i=0;i<rows.length;i++){
    if (String(rows[i][idxId]).trim() === id){
      sh.deleteRow(i+2);
      return { ok:true, message:'Materi dihapus.' };
    }
  }
  return { ok:false, error:'Materi tidak ditemukan.' };
}

/* =========================
   MATERIAL SUGGEST
   ========================= */
function materialsSuggest_(body){
  const q = String(body.q || '').toLowerCase().trim();

  const sh = getMaterialsSheet_();
  const values = sh.getDataRange().getValues();
  const hasData = values.length >= 2;

  if (!hasData){
    // fallback lama
    const base = [
      'Pembibitan', 'Persiapan Lahan', 'Penanaman', 'Pemupukan', 'Pengendalian Gulma',
      'Panen', 'Pengangkutan TBS', 'K3 Perkebunan', 'Perawatan TM', 'Pruning', 'Grading TBS'
    ];
    const res = !q ? base.slice(0,8) : base.filter(x => x.toLowerCase().includes(q)).slice(0,8);
    return { ok:true, items: res };
  }

  const header = values[0].map(String);
  const rows = values.slice(1);
  const idxName = header.indexOf('name');
  const idxActive = header.indexOf('active');

  const list = rows
    .filter(r => String(r[idxName]||'').trim())
    .filter(r => String(r[idxActive]||'TRUE').toUpperCase() === 'TRUE')
    .map(r => String(r[idxName]||'').trim());

  const filtered = !q ? list : list.filter(x => x.toLowerCase().includes(q));
  return { ok:true, items: filtered.slice(0,8) };
}

/* =========================
   DRIVE PHOTO
   ========================= */
function saveFacePhoto_(nik, nama, dataUrl){
  const folder = DriveApp.getFolderById(FACES_FOLDER_ID);
  const parts = dataUrl.split(',');
  const meta = parts[0];
  const b64  = parts[1];
  const mime = meta.match(/data:(.*);base64/)[1];
  const bytes = Utilities.base64Decode(b64);
  const blob = Utilities.newBlob(bytes, mime, `FACE_${nik}_${sanitize_(nama)}_${Date.now()}.jpg`);
  const file = folder.createFile(blob);
  return file.getId();
}

/* =========================
   UTILS
   ========================= */
function json_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function decodePayload_(p){
  // Support: base64websafe(JSON) atau URL-encoded JSON
  const s = String(p || '').trim();
  if (!s) return {};

  // Coba JSON langsung (kalau app.js kirim p=encodeURIComponent(JSON.stringify(...)))
  try {
    const maybeJson = decodeURIComponent(s);
    if (maybeJson && (maybeJson[0] === '{' || maybeJson[0] === '[')) return JSON.parse(maybeJson);
  } catch(e){}

  // Coba Base64 WebSafe
  try{
    const bytes = Utilities.base64DecodeWebSafe(s);
    const json = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    return JSON.parse(json);
  } catch(e){}

  throw new Error('Invalid payload p');
}

function assertAdmin_(payload){
  return requireAdmin_(payload);
}

function sha256_(s){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0'+((b<0?b+256:b).toString(16))).slice(-2)).join('');
}

function euclidean_(a,b){
  let s=0;
  for (let i=0;i<a.length;i++){
    const d = Number(a[i]) - Number(b[i]);
    s += d*d;
  }
  return Math.sqrt(s);
}

function haversineM_(lat1,lng1,lat2,lng2){
  const R=6371000;
  const toRad = x => x*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLng=toRad(lng2-lng1);
  const A = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  const C = 2*Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
  return R*C;
}

function sanitize_(s){
  return String(s||'').replace(/[^\w]+/g,'_').slice(0,40);
}

function RUN_testExportXlsx(){
  // buat report dummy paling sederhana
  const ss = SpreadsheetApp.create('TMP_TEST_EXPORT_' + Date.now());
  const sh = ss.getSheets()[0];
  sh.getRange('A1').setValue('TEST XLSX EXPORT OK');

  const blob = exportSpreadsheetBlob_(ss.getId(), 'xlsx');
  DriveApp.getFileById(ss.getId()).setTrashed(true);

  // simpan hasil ke drive sebagai bukti
  const out = DriveApp.createFile(blob.setName('TEST_EXPORT.xlsx'));
  Logger.log('Created: ' + out.getUrl());
}

function RUN_testExportPdf(){
  const ss = SpreadsheetApp.create('TMP_TEST_EXPORT_' + Date.now());
  const sh = ss.getSheets()[0];
  sh.getRange('A1').setValue('TEST PDF EXPORT OK');

  const blob = exportSpreadsheetBlob_(ss.getId(), 'pdf');
  DriveApp.getFileById(ss.getId()).setTrashed(true);

  const out = DriveApp.createFile(blob.setName('TEST_EXPORT.pdf'));
  Logger.log('Created: ' + out.getUrl());
}

function adminPesertaList_(payload){
  assertAdmin_(payload);

  const trainingType = String(payload.training_type || payload.jenis_pelatihan || '').trim(); // ✅ baru
  const group = String(payload.group || '').trim();
  const q = String(payload.q || '').trim().toLowerCase();
  const limit = Math.min(Number(payload.limit || 300), 2000);

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_PESERTA) || ss.getSheetByName('peserta');
  if (!sh) return { ok:false, error:'Sheet peserta tidak ditemukan' };

  ensurePesertaHeader_(sh);

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:true, items:[] };

  const headRaw = values[0].map(h => String(h||'').trim());
  const head = headRaw.map(h => h.toLowerCase());

  const idx = (keys, fallback)=> {
    for (const k of keys){
      const i = head.indexOf(k);
      if (i >= 0) return i;
    }
    return fallback;
  };

  // ✅ map kolom sesuai template master_peserta.xlsx
  const nikIdx    = idx(['nik'], 0);
  const namaIdx   = idx(['nama'], 1);
  const jpIdx     = idx(['jenis_pelatihan','jenis pelatihan','training_type','training type'], -1);
  const tahunIdx  = idx(['tahun','year'], -1);
  const ojtIdx    = idx(['lokasi_ojt','lokasi ojt','ojt'], -1);
  const unitIdx   = idx(['unit','estate'], -1);
  const regionIdx = idx(['region'], -1);
  const groupIdx  = idx(['group','batch','kelas','angkatan'], 2);

  const out = [];

  for (let i=1; i<values.length; i++){
    const row = values[i];

    const nikV   = String(row[nikIdx] || '').trim();
    const namaV  = String(row[namaIdx] || '').trim();
    const grpV   = String(row[groupIdx] || '').trim();

    if (!nikV || !namaV) continue;

    const jpV    = (jpIdx>=0) ? String(row[jpIdx]||'').trim() : '';
    const tahunV = (tahunIdx>=0) ? String(row[tahunIdx]||'').trim() : '';
    const ojtV   = (ojtIdx>=0) ? String(row[ojtIdx]||'').trim() : '';
    const unitV  = (unitIdx>=0) ? String(row[unitIdx]||'').trim() : '';
    const regV   = (regionIdx>=0) ? String(row[regionIdx]||'').trim() : '';

    // ✅ filter training type
    if (trainingType && jpV && jpV !== trainingType) continue;
    if (trainingType && !jpV) continue; // kalau sheet belum punya kolom jp => jangan ikut

    // ✅ filter group
    if (group && grpV !== group) continue;

    // ✅ search q (nik/nama/group/unit/region)
    if (q){
      const hay = (nikV+' '+namaV+' '+grpV+' '+jpV+' '+unitV+' '+regV).toLowerCase();
      if (!hay.includes(q)) continue;
    }

    out.push({
      nik: nikV,
      nama: namaV,
      group: grpV,
      jenis_pelatihan: jpV,
      tahun: tahunV,
      lokasi_ojt: ojtV,
      unit: unitV,
      region: regV
    });

    if (out.length >= limit) break;
  }

  return { ok:true, items: out };
}

/* =========================================================
   ✅ ADMIN: IMPORT PESERTA (XLSX dari client)
   Action: adminPesertaImport
   Payload: { admin_token, rows:[{nik,nama,jenis_pelatihan,tahun,lokasi_ojt,unit,region,group}] }
   Behavior:
   - upsert by nik (kalau nik sudah ada -> update)
   - memastikan header sheet peserta sesuai template
   ========================================================= */

function ensurePesertaHeader_(sh){
  const expected = ['nik','nama','jenis_pelatihan','tahun','lokasi_ojt','unit','region','group'];

  // kalau sheet kosong (belum ada header)
  if (sh.getLastRow() === 0){
    sh.getRange(1,1,1,expected.length).setValues([expected]);
    return;
  }

  const cur = sh.getRange(1,1,1,expected.length).getValues()[0].map(x=>String(x||'').trim().toLowerCase());
  const ok = expected.every((h,i)=> (cur[i]||'') === h);

  // kalau header tidak cocok, tetap set ulang baris 1 (lebih aman untuk konsistensi template)
  if (!ok){
    sh.getRange(1,1,1,expected.length).setValues([expected]);
  }
}

function normalizePesertaRow_(r){
  const out = {
    nik: String(r.nik||'').trim(),
    nama: String(r.nama||'').trim(),
    jenis_pelatihan: String(r.jenis_pelatihan||r.training_type||'').trim(),
    tahun: String(r.tahun||'').trim(),
    lokasi_ojt: String(r.lokasi_ojt||'').trim(),
    unit: String(r.unit||'').trim(),
    region: String(r.region||'').trim(),
    group: String(r.group||r.batch||'').trim()
  };
  // rapikan nik (hapus spasi)
  out.nik = out.nik.replace(/\s+/g,'');
  return out;
}

function adminPesertaImport_(payload){
  assertAdmin_(payload);

  const rows = payload.rows || [];
  if (!Array.isArray(rows) || rows.length === 0){
    return { ok:false, error:'Rows kosong' };
  }

  // ✅ auto-create sheet peserta + header aman
  const sh = getPesertaSheet_(); // <— pakai helper yang sudah kita upgrade

  // header sudah dipastikan oleh ensurePesertaHeader_ di getPesertaSheet_()
  const header = sh.getRange(1,1,1,8).getValues()[0].map(x=>String(x||'').trim().toLowerCase());
  const idxNik  = header.indexOf('nik');
  const idxNama = header.indexOf('nama');

  // load existing peserta (untuk cek konflik nama dan untuk upsert)
  const last = sh.getLastRow();
  const data = (last >= 2) ? sh.getRange(2,1,last-1,8).getValues() : [];

  // map nik -> { rowNo, nama }
  const map = {};
  for (let i=0;i<data.length;i++){
    const nik = String(data[i][idxNik] || '').trim();
    const nama = String(data[i][idxNama] || '').trim();
    if (nik) map[nik] = { rowNo: i+2, nama };
  }

  const toAppend = [];
  let updated = 0;
  let inserted = 0;

  let skipped_empty = 0;
  let rejected_missing_training = 0;
  let rejected_name_conflict = 0;

  const warnings = []; // detail warning agar admin paham yang ditolak

  // helper normalisasi nama utk compare (case-insensitive + rapikan spasi)
  const normName = (s)=> String(s||'')
    .trim()
    .toLowerCase()
    .replace(/\s+/g,' ');

  // cegah duplikat NIK di dalam batch import yang sama
  const seenNikInBatch = new Set();

  rows.forEach((r, idx)=>{
    const x = normalizePesertaRow_(r);

    // wajib minimal nik/nama
    if (!x.nik || !x.nama){
      skipped_empty++;
      warnings.push({
        type: 'SKIP_EMPTY',
        row: idx+1,
        nik: x.nik || '',
        nama: x.nama || '',
        message: 'NIK/Nama kosong. Baris dilewati.'
      });
      return;
    }

    // ✅ reject: jenis_pelatihan wajib
    if (!x.jenis_pelatihan){
      rejected_missing_training++;
      warnings.push({
        type: 'REJECT_MISSING_JENIS_PELATIHAN',
        row: idx+1,
        nik: x.nik,
        nama: x.nama,
        message: 'jenis_pelatihan kosong. Baris ditolak.'
      });
      return;
    }

    // ✅ duplikat nik dalam batch import
    if (seenNikInBatch.has(x.nik)){
      warnings.push({
        type: 'REJECT_DUPLICATE_NIK_IN_UPLOAD',
        row: idx+1,
        nik: x.nik,
        nama: x.nama,
        message: 'NIK duplikat di file upload yang sama. Baris ditolak.'
      });
      return;
    }
    seenNikInBatch.add(x.nik);

    const line = [x.nik, x.nama, x.jenis_pelatihan, x.tahun, x.lokasi_ojt, x.unit, x.region, x.group];

    // cek existing by nik
    const ex = map[x.nik];

    if (ex && ex.rowNo){
      // ✅ reject: nik sama tapi nama berbeda (warning + ditolak)
      if (normName(ex.nama) && normName(ex.nama) !== normName(x.nama)){
        rejected_name_conflict++;
        warnings.push({
          type: 'REJECT_NIK_NAME_CONFLICT',
          row: idx+1,
          nik: x.nik,
          nama_upload: x.nama,
          nama_existing: ex.nama,
          message: 'NIK sudah ada tapi nama berbeda. Baris ditolak (tidak update).'
        });
        return;
      }

      // update row
      sh.getRange(ex.rowNo, 1, 1, 8).setValues([line]);
      updated++;
    } else {
      // append nanti (batch)
      toAppend.push(line);
      map[x.nik] = { rowNo: -1, nama: x.nama }; // tanda sudah akan dibuat
      inserted++;
    }
  });

  if (toAppend.length){
    sh.getRange(sh.getLastRow()+1, 1, toAppend.length, 8).setValues(toAppend);
  }

  return {
    ok:true,
    inserted,
    updated,
    skipped_empty,
    rejected_missing_training,
    rejected_name_conflict,
    total_received: rows.length,
    warnings: warnings.slice(0, 200) // batasi supaya response tidak terlalu besar
  };
}

function adminGetPhotoByNik_(payload){
  assertAdmin_(payload);

  var nik = String(payload.nik || '').trim();
  if (!nik) return { ok:false, error:'NIK kosong' };

  var FOLDER_ID = '1Z42pzuNuw5ZNoE7EovI1Ifrf3ppzJmiS';
  var folder = DriveApp.getFolderById(FOLDER_ID);

  // Strategi: cari file yang namanya mengandung NIK (mis: 12345.jpg / foto_12345.png)
  // Jika Anda punya aturan penamaan fix (mis NIK.jpg), bisa dibuat lebih cepat.
  var files = folder.searchFiles('title contains "' + nik.replace(/"/g,'') + '" and (mimeType contains "image/")');

  if (!files.hasNext()){
    return { ok:true, dataUrl:'' }; // tidak ketemu -> kosongkan, biar tetap bisa cetak
  }

  var file = files.next();
  var blob = file.getBlob();
  var mime = blob.getContentType();
  var b64 = Utilities.base64Encode(blob.getBytes());
  var dataUrl = 'data:' + mime + ';base64,' + b64;

  return { ok:true, dataUrl: dataUrl, filename: file.getName() };
}

function adminNameTagSaveEvent_(payload){
  assertAdmin_(payload);

  var settings = payload.settings || {};
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('nametag_settings');
  if (!sh){
    sh = ss.insertSheet('nametag_settings');
    sh.appendRow(['time','event','loc','date','type','bg','layout','logo','cologo','head_fs','head_y','sub_fs','sub_y','name_fs','name_y','photo_s','photo_y']);
  }

  sh.appendRow([
  new Date(),
  settings.event || '',
  settings.loc || '',
  settings.date || '',
  settings.type || '',
  settings.bg || '',
  settings.layout || '',
  settings.logo || '',
  settings.cologo || '',

  settings.head_fs || '',
  settings.head_y || '',
  settings.sub_fs || '',
  settings.sub_y || '',

  settings.name_fs || '',
  settings.name_y || '',
  settings.photo_s || '',
  settings.photo_y || '',
]);

  return { ok:true, message:'Saved' };
}



/* =========================================================
   ✅ Public API: Multi Geofence + Live Map
   - geofence.list : ambil daftar geofence aktif (public)
   - live.ping     : kirim lokasi device (public)
   - live.list     : ambil lokasi device terbaru (public)
   ========================================================= */

function geofenceList_(body){
  const items = readGeofencePoints_({ includeInactive:false });
  return { ok:true, items };
}

function getLiveLocationsSheet_(){
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName('live_locations');
  if (!sh){
    sh = ss.insertSheet('live_locations');
    sh.appendRow(['device_id','name','lat','lng','accuracy_m','updated_at','ua']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function livePing_(body){
  // body: {device_id, name, lat, lng, accuracy_m, ua}
  const deviceId = String(body.device_id || '').trim();
  if (!deviceId) return { ok:false, error:'device_id wajib.' };

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const acc = Number(body.accuracy_m || 0);
  if (!isFinite(lat) || !isFinite(lng)) return { ok:false, error:'lat/lng tidak valid.' };

  const name = String(body.name || '').trim();
  const ua = String(body.ua || '').trim().slice(0,180);
  const now = new Date();

  const sh = getLiveLocationsSheet_();
  const values = sh.getDataRange().getValues();
  const header = values[0].map(h=>String(h||'').trim().toLowerCase());
  const idx = (k)=> header.indexOf(k);

  let rowIndex = -1;
  for (let i=1; i<values.length; i++){
    const id = String(values[i][idx('device_id')] || '').trim();
    if (id === deviceId){ rowIndex = i+1; break; } // 1-based
  }

  const row = [deviceId, name, lat, lng, acc, now.toISOString(), ua];
  if (rowIndex > 0){
    sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }else{
    sh.appendRow(row);
  }

  return { ok:true };
}

function liveList_(body){
  // optional: max_age_min (default 180)
  const maxAgeMin = Number(body.max_age_min || 180);
  const maxAgeMs = (isFinite(maxAgeMin) && maxAgeMin > 0) ? (maxAgeMin * 60 * 1000) : (180 * 60 * 1000);
  const now = Date.now();

  const sh = getLiveLocationsSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return { ok:true, items: [] };

  const header = values[0].map(h=>String(h||'').trim().toLowerCase());
  const idx = (k)=> header.indexOf(k);

  const out = values.slice(1)
    .filter(r => String(r[idx('device_id')]||'').trim())
    .map(r => ({
      device_id: String(r[idx('device_id')]||'').trim(),
      name: String(r[idx('name')]||'').trim(),
      lat: Number(r[idx('lat')]),
      lng: Number(r[idx('lng')]),
      accuracy_m: Number(r[idx('accuracy_m')]||0),
      updated_at: String(r[idx('updated_at')]||'').trim(),
      ua: String(r[idx('ua')]||'').trim()
    }))
    .filter(o => isFinite(o.lat) && isFinite(o.lng))
    .filter(o => {
      if (!o.updated_at) return true;
      const t = Date.parse(o.updated_at);
      if (!isFinite(t)) return true;
      return (now - t) <= maxAgeMs;
    });

  // sort terbaru
  out.sort((a,b)=> (Date.parse(b.updated_at||0) - Date.parse(a.updated_at||0)));

  return { ok:true, items: out };
}
