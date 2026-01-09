// SECTION: Admin Page - Enroll
// Purpose : Admin enroll peserta (manual, tarik server by NIK, upload XLSX) + enhancements (autosuggest, validation).
// Depends : core/base.js, core/api.js, core/busy.js, core/status.js, core/training_meta_public.js (optional), libs/xlsx.
// Provides: initEnrollEnhance(), enrollUploadXlsxToServer(), enrollParseXlsx(), enrollUpdateInfo().

/* =========================
   ENROLL FLOW (admin)
   - multi-shot 5 avg
   - photo saved
   ========================= */
async function doEnroll(){
  return runExclusive('enroll', async()=>{
    try{
      if (!isAdminSessionValid()){
        UI.setAdminResult('Admin belum login / sesi habis. Login ulang.', false);
        return;
      }

      const nik = ($('#a_nik').value || '').trim();
      const nama = ($('#a_nama').value || '').trim();
      const bio  = ($('#a_bio').value || '').trim();
      const note = ($('#a_note').value || '').trim();
      if (!nik || !nama){
        UI.setAdminResult('NIK dan Nama wajib.', false);
        return;
      }

      UI.setAdminResult('Rekam wajah (multi-shot 5x)… jangan banyak bergerak.', true);

      const descAvg = await captureMultiShotAvg($('#a_video'), 5, 4000);
      if (!descAvg){
        UI.setAdminResult('Gagal menangkap 5 shot wajah. Pastikan cahaya dan wajah jelas.', false);
        return;
      }

      const photo = await capturePhotoDataURL($('#a_video'));

      const r = await api('enroll', {
        admin_token: State.adminToken,
        nik, nama,
        biodata: { bio, note },
        descriptor_avg: descAvg,
        photo_base64: photo
      });

      if (r.ok){
        UI.setAdminResult(`Tersimpan: <b>${escapeHtml(r.nama)}</b> (NIK: ${escapeHtml(r.nik)})`, true);
      } else {
        UI.setAdminResult(r.error || 'Gagal enroll', false);
      }
    } catch(err){
      if (handleAdminAuthError_(err)) return;
      UI.setAdminResult(String(err?.message || err), false);
    }
  });
}

/* =========================================================
   ✅ ENROLL ENHANCE: Local Master + Auto Suggest + Upload XLSX
   ========================================================= */

const ENROLL = {
  LS_KEY: 'enroll_master_local_v1',
  rows: [],            // [{nik,nama,jenis_pelatihan,tahun,lokasi_ojt,unit,region,group}]
  loadedFrom: '',      // 'server' | 'upload' | ''
};

function enrollNormStr(x){
  return String(x ?? '').trim();
}
function enrollNormNik(x){
  return enrollNormStr(x).replace(/\s+/g,'');
}
function enrollNameKey(x){
  return enrollNormStr(x).toLowerCase();
}

function enrollSaveToLS(){
  try{
    localStorage.setItem(ENROLL.LS_KEY, JSON.stringify({
      rows: ENROLL.rows,
      loadedFrom: ENROLL.loadedFrom,
      savedAt: Date.now()
    }));
  }catch(e){}
}
function enrollLoadFromLS(){
  try{
    const raw = localStorage.getItem(ENROLL.LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    ENROLL.rows = Array.isArray(obj.rows) ? obj.rows : [];
    ENROLL.loadedFrom = String(obj.loadedFrom || '');
  }catch(e){
    ENROLL.rows = [];
    ENROLL.loadedFrom = '';
  }
}

function enrollSetRows(rows, source){
  ENROLL.rows = (rows || []).map(r => ({
    nik: enrollNormNik(r.nik),
    nama: enrollNormStr(r.nama),
    jenis_pelatihan: enrollNormStr(r.jenis_pelatihan),
    tahun: r.tahun ?? '',
    lokasi_ojt: enrollNormStr(r.lokasi_ojt),
    unit: enrollNormStr(r.unit),
    region: enrollNormStr(r.region),
    group: enrollNormStr(r.group),
  })).filter(x => x.nik && x.nama);

  ENROLL.loadedFrom = source || '';
  enrollSaveToLS();
  enrollUpdateInfo();
}

function enrollClearLocal(){
  ENROLL.rows = [];
  ENROLL.loadedFrom = '';
  try{ localStorage.removeItem(ENROLL.LS_KEY); }catch(e){}
  enrollUpdateInfo();
}

function enrollUpdateInfo(){
  const el = document.getElementById('e_info');
  if (!el) return;

  if (!ENROLL.rows.length){
    el.textContent = 'Belum ada data peserta yang dimuat.';
    return;
  }

  el.textContent = `✅ Master lokal: ${ENROLL.rows.length} peserta (sumber: ${ENROLL.loadedFrom || 'local'})`;
}

function enrollSuggestFind(q, limit=8){
  q = enrollNormStr(q);
  if (!q || ENROLL.rows.length === 0) return [];

  const isNum = /^[0-9]+$/.test(q);
  const qLow = q.toLowerCase();

  // skor sederhana agar yang paling cocok di atas
  const scored = [];

  for (const r of ENROLL.rows){
    const nik = r.nik || '';
    const nama = r.nama || '';
    const namaLow = nama.toLowerCase();

    let score = -1;

    if (isNum){
      if (nik.startsWith(q)) score = 100 - (nik.length - q.length);
      else if (nik.includes(q)) score = 70;
      else if (namaLow.includes(qLow)) score = 40;
    } else {
      if (namaLow.startsWith(qLow)) score = 100 - (namaLow.length - qLow.length);
      else if (namaLow.includes(qLow)) score = 80;
      else if (nik.startsWith(q)) score = 60;
      else if (nik.includes(q)) score = 50;
    }

    if (score >= 0){
      scored.push({ r, score });
    }
  }

  scored.sort((a,b)=> b.score - a.score);
  return scored.slice(0, limit).map(x => x.r);
}

function enrollFillForm(r){
  if (!r) return;

  // Auto isi: NIK, Nama, Biodata (pakai Group)
  const nikEl  = document.getElementById('a_nik');
  const namaEl = document.getElementById('a_nama');
  const bioEl  = document.getElementById('a_bio');
  const noteEl = document.getElementById('a_note');

  if (nikEl) nikEl.value = r.nik || '';
  if (namaEl) namaEl.value = r.nama || '';

  // Biodata: fokus ke Group/Batch (sesuai permintaan)
  if (bioEl){
    bioEl.value = (r.group || '').trim();
  }

  // Catatan: opsional, tapi kita bantu isi info OJT (silakan ubah)
  if (noteEl && !noteEl.value){
    const parts = [];
    if (r.unit) parts.push(r.unit);
    if (r.region) parts.push(r.region);
    if (r.lokasi_ojt) parts.push('OJT: '+r.lokasi_ojt);
    noteEl.value = parts.join(' • ');
  }
}


/* =========================================================
   ✅ FIX ENROLL AUTO-SUGGEST (PORTAL, ANTI CLIP MODAL)
   - Dropdown ditempel ke document.body (tidak kepotong overflow modal)
   - Posisi fixed tepat di bawah input aktif
   - Works untuk #a_nik dan #a_nama
   ========================================================= */

function enrollEnsureSuggestUI(){
  // gunakan existing kalau ada, tapi jadikan "portal" ke body + fixed
  let wrap = document.getElementById('enroll-suggest');
  let list = document.getElementById('enroll-suggest-list');

  if (!wrap){
    wrap = document.createElement('div');
    wrap.id = 'enroll-suggest';
    wrap.className = 'suggest hidden';
  }

  if (!list){
    list = document.createElement('div');
    list.id = 'enroll-suggest-list';
    wrap.appendChild(list);
  }

  // ✅ PENTING: pastikan wrap menjadi child dari body (hindari clip modal)
  if (wrap.parentElement !== document.body){
    document.body.appendChild(wrap);
  }

  // ✅ paksa style portal (override inline HTML Anda)
  wrap.style.position = 'fixed';
  wrap.style.zIndex = '99999';
  wrap.style.left = '0px';
  wrap.style.top = '0px';
  wrap.style.width = '280px';
  wrap.style.maxHeight = '260px';
  wrap.style.overflow = 'auto';
  wrap.style.borderRadius = '12px';
  wrap.style.boxShadow = '0 18px 40px rgba(0,0,0,.35)';

  // background ikut tema: pakai CSS variable kalau ada
  wrap.style.background = 'var(--card, #111827)';
  wrap.style.border = '1px solid rgba(255,255,255,.12)';

  // list tidak perlu absolute lagi (biar simpel)
  list.style.position = 'static';

  return { wrap, list };
}

function enrollPositionSuggestUnder(inputEl){
  if (!inputEl) return;
  const { wrap } = enrollEnsureSuggestUI();

  const r = inputEl.getBoundingClientRect();
  const gap = 6;

  // fixed: pakai viewport coords (tanpa scrollY)
  wrap.style.left = Math.max(8, Math.round(r.left)) + 'px';
  wrap.style.top  = Math.round(r.bottom + gap) + 'px';
  wrap.style.width = Math.max(240, Math.round(r.width)) + 'px';
}

function enrollSuggestHide(){
  const wrap = document.getElementById('enroll-suggest');
  const list = document.getElementById('enroll-suggest-list');
  if (wrap) wrap.classList.add('hidden');
  if (list) list.innerHTML = '';
}

function enrollSuggestShow(items){
  const { wrap, list } = enrollEnsureSuggestUI();

  if (!items || items.length === 0){
    enrollSuggestHide();
    return;
  }

  wrap.classList.remove('hidden');

  list.innerHTML = items.map((r, i)=>`
    <div class="sug-item" data-i="${i}">
      <div style="min-width:0;">
        <b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">
          ${escapeHtml(r.nama || '-')}
        </b>
        <div class="sug-mini">${escapeHtml(r.group || r.jenis_pelatihan || '')}</div>
      </div>
      <div class="sug-mini" style="text-align:right;flex-shrink:0;">
        <div><b>${escapeHtml(r.nik || '')}</b></div>
        <div>${escapeHtml(r.unit || r.region || '')}</div>
      </div>
    </div>
  `).join('');

  // ✅ mousedown supaya tidak kalah oleh blur input
  list.querySelectorAll('.sug-item').forEach(el=>{
    el.addEventListener('mousedown', (e)=>{
      e.preventDefault();
      const idx = Number(el.getAttribute('data-i'));
      const chosen = items[idx];
      enrollFillForm(chosen);
      enrollSuggestHide();
      UI.setAdminResult(`Auto-isi dari master: ${chosen.nama}`, true);
      document.getElementById('a_bio')?.focus?.();
    });
  });
}

function enrollBindAutoSuggest(){
  const nikEl  = document.getElementById('a_nik');
  const namaEl = document.getElementById('a_nama');
  if (!nikEl && !namaEl) return;

  // hindari bind dobel
  if (State._enrollSuggestBound) return;
  State._enrollSuggestBound = true;

  enrollEnsureSuggestUI();

  const runSearch = debounce((activeEl)=>{
    if (!ENROLL.rows.length){
      enrollSuggestHide();
      return;
    }

    const q = String(activeEl?.value || '').trim();
    if (!q){
      enrollSuggestHide();
      return;
    }

    enrollPositionSuggestUnder(activeEl);

    const items = enrollSuggestFind(q, 8);
    enrollSuggestShow(items);
  }, 120);

  const bindOne = (el)=>{
    if (!el) return;
    el.setAttribute('autocomplete','off');

    el.addEventListener('input', ()=> runSearch(el));
    el.addEventListener('focus', ()=> runSearch(el));

    el.addEventListener('blur', ()=>{
      setTimeout(()=> enrollSuggestHide(), 180);
    });

    el.addEventListener('keydown', (e)=>{
      if (e.key === 'Escape') enrollSuggestHide();
    });
  };

  bindOne(nikEl);
  bindOne(namaEl);

  // klik luar untuk tutup
  document.addEventListener('mousedown', (e)=>{
    const wrap = document.getElementById('enroll-suggest');
    const list = document.getElementById('enroll-suggest-list');
    if (!wrap || !list) return;

    const t = e.target;
    if (t === nikEl || t === namaEl) return;
    if (wrap.contains(t)) return;

    enrollSuggestHide();
  });

  // reposition saat scroll/resize jika dropdown sedang tampil
  const reposition = ()=>{
    const wrap = document.getElementById('enroll-suggest');
    if (!wrap || wrap.classList.contains('hidden')) return;

    const active =
      (document.activeElement === nikEl) ? nikEl :
      (document.activeElement === namaEl) ? namaEl : null;

    if (active) enrollPositionSuggestUnder(active);
  };

  window.addEventListener('scroll', reposition, { passive:true });
  window.addEventListener('resize', reposition);
}

/*
// ✅ override: show harus selalu reposition
const _enrollSuggestShowOrig = enrollSuggestShow;
enrollSuggestShow = function(items){
  const { wrap, list } = enrollEnsureSuggestUI();

  if (!items || items.length === 0){
    enrollSuggestHide();
    return;
  }

  wrap.classList.remove('hidden');

  list.innerHTML = items.map((r, i)=>`
    <div class="sug-item" data-i="${i}" style="
      display:flex;justify-content:space-between;gap:10px;
      padding:10px 12px; cursor:pointer; border-bottom:1px solid rgba(0,0,0,.06);
    ">
      <div style="min-width:0;">
        <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(r.nama || '-')}
        </div>
        <div class="sug-mini" style="opacity:.8;font-size:12px;">
          ${escapeHtml(r.group || r.jenis_pelatihan || '')}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-weight:900;font-size:12px;">${escapeHtml(r.nik || '')}</div>
        <div class="sug-mini" style="opacity:.8;font-size:12px;">
          ${escapeHtml(r.unit || r.region || '')}
        </div>
      </div>
    </div>
  `).join('');

  // click pilih
  list.querySelectorAll('.sug-item').forEach(el=>{
    el.addEventListener('mousedown', (e)=>{
      // mousedown supaya tidak “kalah” oleh blur input
      e.preventDefault();
      const idx = Number(el.getAttribute('data-i'));
      const chosen = items[idx];
      enrollFillForm(chosen);
      enrollSuggestHide();
      UI.setAdminResult(`Auto-isi dari master: ${chosen.nama}`, true);

      // fokus ke field berikutnya biar enak
      document.getElementById('a_bio')?.focus?.();
    });
  });
};

*/

/* -------------------------
   Load master dari server (filter TT + Group)
   - pakai action adminPesertaList (yang sudah ada di aplikasi Anda)
   ------------------------- */
async function enrollLoadFromServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const tt = (document.getElementById('e_training_type')?.value || '').trim();
  const gp = (document.getElementById('e_group')?.value || '').trim();
  if (!tt || !gp){
    UI.setAdminResult('Pilih Training Type & Batch/Group terlebih dahulu.', false);
    return;
  }

  const r = await api('adminPesertaList', {
    admin_token: State.adminToken,
    training_type: tt,
    group: gp,
    q: '',
    limit: 1200
  });

  if (!r.ok) throw new Error(r.error || 'Gagal load peserta (server)');

  // r.items minimal berisi nik,nama,batch/group; kalau kolom lain tidak ada, aman (fallback kosong)
  const rows = (r.items || []).map(x=>({
    nik: x.nik,
    nama: x.nama,
    jenis_pelatihan: x.jenis_pelatihan || tt,
    tahun: x.tahun || '',
    lokasi_ojt: x.lokasi_ojt || '',
    unit: x.unit || '',
    region: x.region || '',
    group: x.group || x.batch || gp
  }));

  enrollSetRows(rows, 'server');
  UI.setAdminResult(`Master peserta dimuat: ${rows.length} orang. Ketik NIK/Nama untuk sugesti.`, true);
}

/* -------------------------
   Upload XLSX -> parse -> kirim ke GAS (adminPesertaImport)
   ------------------------- */

function enrollEnsureXlsxLib(){
  return !!window.XLSX;
}

function enrollParseXlsx(file){
  return new Promise((resolve, reject)=>{
    if (!enrollEnsureXlsxLib()){
      return reject(new Error('Library XLSX belum tersedia. Tambahkan xlsx.full.min.js (SheetJS) terlebih dahulu.'));
    }
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type:'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws, { defval:'' }); // array of objects
        resolve(json);
      }catch(err){
        reject(err);
      }
    };
    reader.onerror = ()=> reject(new Error('Gagal membaca file XLSX'));
    reader.readAsArrayBuffer(file);
  });
}

function enrollValidateTemplate(rows){
  const need = ['nik','nama','jenis_pelatihan','tahun','lokasi_ojt','unit','region','group'];
  const first = rows && rows[0] ? Object.keys(rows[0]) : [];
  const missing = need.filter(k => !first.includes(k));
  if (missing.length){
    throw new Error('Format template tidak sesuai. Kolom kurang: ' + missing.join(', '));
  }
}

function chunkArray(arr, size){
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
  return out;
}

async function enrollUploadXlsxToServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  const fileEl = document.getElementById('e_file');
  const infoEl = document.getElementById('e_upload_info');
  const f = fileEl?.files?.[0];
  if (!f) throw new Error('Pilih file .xlsx terlebih dahulu.');

  if (infoEl) infoEl.textContent = '⏳ Membaca XLSX…';

  const rawRows = await enrollParseXlsx(f);
  if (!rawRows.length) throw new Error('XLSX kosong / tidak ada data.');

  enrollValidateTemplate(rawRows);

  // normalisasi
  const rows = rawRows.map(r => ({
    nik: enrollNormNik(r.nik),
    nama: enrollNormStr(r.nama),
    jenis_pelatihan: enrollNormStr(r.jenis_pelatihan),
    tahun: r.tahun ?? '',
    lokasi_ojt: enrollNormStr(r.lokasi_ojt),
    unit: enrollNormStr(r.unit),
    region: enrollNormStr(r.region),
    group: enrollNormStr(r.group),
  })).filter(x => x.nik && x.nama);

  if (!rows.length) throw new Error('Data valid 0 baris (cek kolom nik/nama).');

  // kirim per-chunk biar aman payload
  const chunks = chunkArray(rows, 200);

  // ✅ akumulasi hasil
  const allWarnings = [];
  const agg = {
    inserted: 0,
    updated: 0,
    skipped_empty: 0,
    rejected_missing_training: 0,
    rejected_name_conflict: 0,
    total_received: 0
  };

  for (let i=0;i<chunks.length;i++){
    if (infoEl) infoEl.innerHTML = `<div class="small">⏳ Upload chunk ${i+1}/${chunks.length}…</div>`;

    const r = await api('adminPesertaImport', {
      admin_token: State.adminToken,
      rows: chunks[i]
    });

    if (!r.ok){
      // tampilkan error + raw
      if (infoEl){
        infoEl.innerHTML = `
          <div style="font-weight:900;margin-bottom:6px;">❌ Upload gagal</div>
          <div class="small">${escapeHtml(r.error || 'Unknown error')}</div>
        `;
      }
      throw new Error(r.error || `Upload gagal di chunk ${i+1}`);
    }

    // ✅ agregasi angka
    agg.inserted += Number(r.inserted || 0);
    agg.updated  += Number(r.updated  || 0);
    agg.skipped_empty += Number(r.skipped_empty || 0);
    agg.rejected_missing_training += Number(r.rejected_missing_training || 0);
    agg.rejected_name_conflict += Number(r.rejected_name_conflict || 0);
    agg.total_received += Number(r.total_received || 0);

    // ✅ kumpulkan warnings (batasi supaya tidak meledak)
    if (Array.isArray(r.warnings) && r.warnings.length){
      // tambahkan info chunk supaya mudah ditelusuri
      r.warnings.forEach(w=>{
        allWarnings.push({ ...w, chunk: i+1 });
      });
    }

    // ✅ tampilkan result chunk + warnings dalam <details>
    if (infoEl){
      // kita sisipkan info chunk pada title, dan buat details berisi warnings chunk ini
      const chunkInfo = `Progress: ${i+1}/${chunks.length} • (chunk size: ${chunks[i].length})`;
      renderImportResultToUploadInfo(infoEl, r, {
        chunkInfo,
        detailsTitle: `Warnings chunk ${i+1} (${(r.warnings||[]).length})`
      });
    }
  }

  // ✅ Ringkasan akhir + warnings gabungan
  if (infoEl){
    const summaryHtml = `
      <div style="font-weight:900;margin-bottom:6px;">✅ Upload selesai</div>
      <div class="small">
        File: <b>${escapeHtml(f.name)}</b><br/>
        Total data: <b>${rows.length}</b> • Insert: <b>${agg.inserted}</b> • Update: <b>${agg.updated}</b><br/>
        Skip kosong: <b>${agg.skipped_empty}</b> • Tolak jenis_pelatihan kosong: <b>${agg.rejected_missing_training}</b> • Tolak konflik nama: <b>${agg.rejected_name_conflict}</b>
      </div>
    `;

    // group warnings (tampilkan sampai 200 seperti backend, tapi bisa lebih karena akumulasi chunk)
    const detailsAll = formatImportWarningsDetails(
      allWarnings.slice(0, 800), // batasi render UI (silakan naik/turun)
      `Warnings total (${allWarnings.length})`
    );

    infoEl.innerHTML = summaryHtml + (detailsAll || '');
  }

  // Setelah upload, set master lokal juga supaya langsung bisa sugest
  enrollSetRows(rows, 'upload');

  // ✅ hasil admin modal
  if (allWarnings.length){
    UI.setAdminResult(`Upload peserta selesai. Ada ${allWarnings.length} warning (klik detail di bawah).`, true);
  } else {
    UI.setAdminResult(`Upload peserta sukses (${rows.length}). Tidak ada warning.`, true);
  }
}

/* -------------------------
   Download template (file statis di folder template)
   ------------------------- */
function enrollDownloadTemplate(){
  const TEMPLATE_URL = './template/master_peserta.xlsx';
  const a = document.createElement('a');
  a.href = TEMPLATE_URL;
  a.download = 'master_peserta.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* -------------------------
   Init enroll enhance (dipanggil saat admin login)
   ------------------------- */
function initEnrollEnhance(){
  // restore master dari LS (kalau ada)
  enrollLoadFromLS();
  enrollUpdateInfo();
  enrollBindAutoSuggest();

  // isi dropdown enroll dari meta (pakai meta dashboard agar konsisten)
  const meta = State._dashMeta || {};
  const ttEl = document.getElementById('e_training_type');
  const grpEl = document.getElementById('e_group');

  if (ttEl && grpEl){
    const trainingTypes = (meta.jenis_pelatihan || meta.training_types || []);
    fillSelect(ttEl, trainingTypes, 'Pilih Training Type…');

    const refreshGroups = ()=>{
      const tt = (ttEl.value || '').trim();
      const groupsByType = meta.groups_by_training_type || {};
      const groups = tt ? (groupsByType[tt] || []) : (meta.groups || []);
      fillSelect(grpEl, groups, 'Pilih Batch…');
    };

    ttEl.addEventListener('change', refreshGroups);
    refreshGroups();
  }

  // bind buttons
  document.getElementById('btn-e-load')?.addEventListener('click', ()=> Busy.wrap(
    document.getElementById('btn-e-load'),
    async()=> await enrollLoadFromServer(),
    { text:'Memuat…', overlay:true, overlayText:'Memuat master peserta dari server…' }
  ));

  document.getElementById('btn-e-clear')?.addEventListener('click', ()=>{
    if (!confirm('Clear data master lokal? (Auto-suggest akan kosong)')) return;
    enrollClearLocal();
    UI.setAdminResult('Master lokal dibersihkan.', true);
  });

  document.getElementById('btn-e-template')?.addEventListener('click', ()=>{
    enrollDownloadTemplate();
  });

  document.getElementById('btn-e-upload')?.addEventListener('click', ()=> Busy.wrap(
    document.getElementById('btn-e-upload'),
    async()=> await enrollUploadXlsxToServer(),
    { text:'Upload…', overlay:true, overlayText:'Upload master peserta (XLSX) ke server…' }
  ));
}

