// SECTION: Core Status / Result Engine
// Purpose : Centralized status messaging, validation, and display helpers for camera/presensi.
// Depends : js/core/base.js (UI, State, $).
// Provides: setStatusOk/Err(), setResultOk/Err(), scanBadge helpers, debounce utilities.

/* =========================================================
   ✅ SMART STATUS ENGINE (lebih responsif)
   - Auto update status saat user ubah pilihan
   - Tidak menimpa pesan "proses" (scan/liveness/presensi)
   ========================================================= */

// status lock: kalau sedang proses presensi/liveness, jangan override pesan
State.ui = State.ui || {};
State.ui.statusLock = false;
State.ui.lastCtxKey = '';
State.ui.lastStatusKey = '';

function statusSetLock(on){
  State.ui.statusLock = !!on;
}

function setPresensiFail(msg){
  State.ui.lastPresensiFailed = true;
  State.ui.lastFailMessage = String(msg || 'Presensi gagal.');
}

function clearPresensiFail(){
  State.ui.lastPresensiFailed = false;
  State.ui.lastFailMessage = '';
}

// Ambil konteks form saat ini untuk deteksi perubahan (mode, pilihan, arah)
function getCtxKey_(){
  const mode = ($('#mode')?.value || 'training');
  const tt   = ($('#training_type')?.value || '').trim();
  const act  = ($('#activity')?.value || '').trim();
  const mat  = ($('#material')?.value || '').trim();
  const reason = ($('#gate_reason')?.value || '').trim();
  const dir  = (State.gateDirection || '');
  // lokasi kita jadikan bagian key supaya ketika inFence berubah, status ikut update
  const locKey = (State.locError ? 'LOCERR' : (isFinite(State.loc.distance_m) ? (State.loc.inFence ? 'INFENCE' : 'OUTFENCE') : 'LOADING'));
  return [mode, tt, act, mat, reason, dir, locKey].join('|');
}

function needMaterial_(activity){
  const a = String(activity||'').trim().toLowerCase();
  return (a === 'sesi kelas' || a === 'field day');
}

// Hitung readiness + pesan “apa yang kurang” (lebih detail)
function computeReadiness_(){
  // 1) lokasi
  if (State.locError){
    return { ok:false, key:'LOC_ERR', msg:'Izin lokasi belum aktif. Klik <b>Cek Lokasi</b> lalu izinkan GPS.' };
  }
  if (!isFinite(State.loc.distance_m)){
    return { ok:false, key:'LOC_WAIT', msg:'Lokasi belum terdeteksi. Klik <b>Cek Lokasi</b>.' };
  }
  if (!State.loc.inFence){
    return { ok:false, key:'LOC_OUT', msg:`Di luar area presensi (${Math.round(State.loc.distance_m)} m). Dekati area Training Center.` };
  }

  // 2) mode
  const mode = ($('#mode')?.value || 'training');

  if (mode === 'training'){
    const tt  = ($('#training_type')?.value || '').trim();
    const act = ($('#activity')?.value || '').trim();
    const mat = ($('#material')?.value || '').trim();

    const missing = [];
    if (!tt) missing.push('Training Type');
    if (!act) missing.push('Activity');

    if (act && needMaterial_(act) && !mat) missing.push('Materi');

    if (missing.length){
      // pesan lebih spesifik
      return {
        ok:false,
        key:'TR_MISS_' + missing.join('_'),
        msg:`Belum siap presensi. Lengkapi: <b>${missing.join(', ')}</b>.`
      };
    }

    return {
      ok:true,
      key:'TR_OK',
      msg:`Siap presensi Training: <b>${escapeHtml(tt)}</b> / <b>${escapeHtml(act)}</b>${mat?(' • Materi: <b>'+escapeHtml(mat)+'</b>'):''}.`
    };
  }

    // gate / mobilitas 
  const reason = ($('#gate_reason')?.value || '').trim();
  const dir = State.gateDirection || '';

  // 1) Belum isi keperluan
  if (!reason){
    return {
      ok:false,
      key:'GT_NO_REASON',
      msg:'Belum siap presensi Mobilitas. Pilih / isi <b>Keperluan</b> terlebih dahulu.'
    };
  }

  // 2) Keperluan sudah ada -> status BERHASIL (siap)
  //    Arah akan otomatis di-set saat klik tombol Masuk/Keluar.
  const hint = dir
    ? `Arah: <b>${dir === 'IN' ? 'MASUK' : 'KELUAR'}</b>.`
    : `Klik tombol <b>Masuk</b> atau <b>Keluar</b> untuk mulai presensi.`;

  return {
    ok:true,
    key:'GT_OK',
    msg:`Siap presensi Mobilitas. Keperluan: <b>${escapeHtml(reason)}</b>.<br/>${hint}`
  };
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

// Update status jika ada perubahan konteks / atau dipaksa
function smartStatusUpdate(force=false){
  if (State.ui.lastPresensiFailed){
  UI.setResult(State.ui.lastFailMessage, false);
  return;
}
  if (State.ui.statusLock) return;
  if (State.ui.outcomeLock) return;

  const ctxKey = getCtxKey_();
  if (!force && ctxKey === State.ui.lastCtxKey) return;

  State.ui.lastCtxKey = ctxKey;

  validateEnablePresensi();

  const st = computeReadiness_();
  const statusKey = st.key + '|' + (st.ok ? '1':'0');

  if (!force && statusKey === State.ui.lastStatusKey) return;
  State.ui.lastStatusKey = statusKey;

  // gunakan setResult supaya ikon ✅/❌ jelas
  UI.setResult(st.msg, !!st.ok);
}

function updatePresensiReadyMessage(){
  // delegasi ke smart engine
  smartStatusUpdate(true);
  return validateEnablePresensi();
}

/* =========================
   Badge indikator konteks scan (di modal kamera peserta)
   ========================= */
function setScanBadge(text, tone='neutral'){
  const el = $('#scan-badge');
  if (!el) return;
  el.textContent = text;

  // reset class tone
  el.classList.remove('neutral','ok','warn','danger');
  el.classList.add(tone);
}

function updateScanBadge(){
  const mode = ($('#mode')?.value || 'training');

  if (mode === 'training'){
    const tt = ($('#training_type')?.value || '').trim();
    const act = ($('#activity')?.value || '').trim();

    const label = `TRAINING${tt ? ': '+tt : ''}${act ? ' / '+act : ''}`;
    setScanBadge(label, 'ok');
    return;
  }

  // gate / mobilitas
  const reason = ($('#gate_reason')?.value || '').trim();
  if (!reason){
    setScanBadge('MOBILITAS: ISI KEPERLUAN', 'warn');
    return;
  }

  // keperluan sudah ada -> badge OK, arah opsional tampil kalau sudah dipilih
  const dir = State.gateDirection
    ? (State.gateDirection === 'IN' ? 'MASUK' : 'KELUAR')
    : 'SIAP';

  setScanBadge(`MOBILITAS: ${dir}`, 'ok');
}

/* =========================
   Materials suggest
   ========================= */
function debounce(fn, ms){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

function formatImportWarningsDetails(warnings, summaryText){
  const arr = Array.isArray(warnings) ? warnings : [];
  if (!arr.length) return '';

  const title = summaryText || `Warnings (${arr.length})`;

  const rowsHtml = arr.map((w, i)=>{
  const type = String(w.type || 'WARN').toUpperCase();
  const row  = escapeHtml(String(w.row ?? (i+1)));
  const nik  = escapeHtml(w.nik || '');
  const nama = escapeHtml(w.nama || w.nama_upload || '');
  const msg  = escapeHtml(w.message || '');

  const cls =
    /REJECT/i.test(type) ? 'danger' :
    /WARN/i.test(type)   ? 'warn' :
    'info';

  const extra = w.nama_existing
    ? `<div class="small" style="opacity:.85;">Existing: <b>${escapeHtml(w.nama_existing)}</b></div>`
    : '';

    return `
      <li>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="tag ${cls}">${escapeHtml(type)}</span>
          <div><b>#${row}</b> • NIK: <b>${nik}</b> • Nama: <b>${nama}</b></div>
        </div>
        <div class="small" style="margin-top:4px;">${msg}</div>
        ${extra}
      </li>
    `;
  }).join('');

  return `
    <details style="margin-top:10px;" open>
      <summary style="cursor:pointer;font-weight:900;">${escapeHtml(title)}</summary>
      <div class="warn-hint">
        Klik untuk melihat daftar baris yang ditolak/dilewati beserta alasannya.
      </div>
      <ol style="margin:0 0 0 18px;padding:0;">
        ${rowsHtml}
      </ol>
    </details>
  `;
}

function renderImportResultToUploadInfo(el, result, opts={}){
  if (!el) return;

  const ok = !!result?.ok;
  const inserted = Number(result?.inserted || 0);
  const updated  = Number(result?.updated || 0);

  const skippedEmpty = Number(result?.skipped_empty || 0);
  const rejTraining  = Number(result?.rejected_missing_training || 0);
  const rejConflict  = Number(result?.rejected_name_conflict || 0);

  const total = Number(result?.total_received || 0);

  const head = `
    <div style="font-weight:900;margin-bottom:6px;">
      ${ok ? '✅' : '❌'} ${ok ? 'UPLOAD OK' : 'UPLOAD ERROR'}
    </div>
    <div class="small">
      Total diterima: <b>${total}</b> • Insert: <b>${inserted}</b> • Update: <b>${updated}</b><br/>
      Skip kosong: <b>${skippedEmpty}</b> • Tolak jenis_pelatihan kosong: <b>${rejTraining}</b> • Tolak konflik nama: <b>${rejConflict}</b>
      ${opts.chunkInfo ? `<br/>${escapeHtml(opts.chunkInfo)}` : ''}
    </div>
  `;

  const warnings = result?.warnings || [];
  const details = formatImportWarningsDetails(
    warnings,
    opts.detailsTitle || `Warnings chunk (${Array.isArray(warnings)?warnings.length:0})`
  );

  el.innerHTML = head + (details || '');
}

function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(String(r.result || ''));
    r.onerror = ()=> reject(new Error('Gagal membaca file'));
    r.readAsDataURL(file);
  });
}

