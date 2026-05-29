// SECTION: Admin Page - NameTag/Card
// Purpose : Generate name tag cards, printing/export, and template selection.
// Depends : core/base.js, core/busy.js, core/status.js (optional).
// Provides: initNameTag(), renderNameTags(), exportNameTags().

/* =========================================================
   ✅ ADMIN: NAME TAG GENERATOR (2 template + preview + print)
   ========================================================= */

const NT = {
  LS_KEY: 'nametag_event_v1',
  LS_PICK_KEY: 'nametag_picked_local_v1',
  photoCache: {},       // nik -> dataUrl
  queue: [],            // [{nik,nama,batch,photoUrl?}]
  selectedNik: '',

  pickedSet: new Set(),
  lastRows: []  
};

function ntDefaultLayouts(){
  return {
    '2up' : { per:2,  cols:1, pad:10, gap:8 },
    '4up' : { per:4,  cols:2, pad:8,  gap:6 },
    '6up' : { per:6,  cols:2, pad:8,  gap:5 },
    '8up' : { per:8,  cols:2, pad:8,  gap:4 },
    '10up': { per:10, cols:2, pad:8,  gap:3 },
    '12up': { per:12, cols:3, pad:7,  gap:3 },
  };
}

function ntDefaultSliderBounds(){
  return {
    head_fs:  { min:6,   max:32,  def:14 },
    head_y:   { min:-80, max:60,  def:0  },
    sub_fs:   { min:6,   max:32,  def:12 },
    sub_y:    { min:-80, max:100, def:0  },
    name_fs:  { min:6,   max:100, def:44 },
    name_y:   { min:-80, max:80,  def:0  },
    photo_s:  { min:50,  max:300, def:160},
    photo_y:  { min:-80, max:80,  def:0  }
  };
}

function ntApplySliderBoundsFromCfg(){
  const B = (State.cfg && State.cfg.nametag_slider_bounds) ? State.cfg.nametag_slider_bounds : null;
  const bounds = B || ntDefaultSliderBounds();

  const map = [
    ['head_fs','nt_head_fs'],
    ['head_y','nt_head_y'],
    ['sub_fs','nt_sub_fs'],
    ['sub_y','nt_sub_y'],
    ['name_fs','nt_name_fs'],
    ['name_y','nt_name_y'],
    ['photo_s','nt_photo_s'],
    ['photo_y','nt_photo_y'],
  ];

  map.forEach(([k, id])=>{
    const el = document.getElementById(id);
    if (!el) return;
    const b = bounds[k] || {};
    if (Number.isFinite(b.min)) el.min = String(b.min);
    if (Number.isFinite(b.max)) el.max = String(b.max);

    // jangan paksa overwrite value user kalau sudah ada,
    // tapi pastikan tetap dalam range
    const v = Number(el.value);
    const mn = Number(el.min);
    const mx = Number(el.max);

    if (!isFinite(v) && Number.isFinite(b.def)) el.value = String(b.def);
    else if (isFinite(v) && isFinite(mn) && v < mn) el.value = String(mn);
    else if (isFinite(v) && isFinite(mx) && v > mx) el.value = String(mx);
  });
}

function ntLoadSettings(){
  const raw = localStorage.getItem(NT.LS_KEY);
  let s = {};
  try{ s = raw ? JSON.parse(raw) : {}; }catch(e){}
  return {
    type: s.type || 'A',
    bg: s.bg || 'dark',
    event: s.event || '',
    loc: s.loc || '',
    date: s.date || '',
    layout: s.layout || '2up',

    // dataURL (bisa besar, tapi masih aman untuk logo kecil)
    logo: s.logo || '',
    cologo: s.cologo || '',

    // ✅ cascading
    training_type: s.training_type || '',
    group: s.group || '',

    name_fs: Number(s.name_fs || 44),
    name_y: Number(s.name_y || 0),
    photo_s: Number(s.photo_s || 160),
    photo_y: Number(s.photo_y || 0),

    // ✅ Header adjust
    head_fs: Number(s.head_fs || 14),   // ukuran header (px)
    head_y:  Number(s.head_y  || 0),    // naik/turun header (px)
    sub_fs:  Number(s.sub_fs  || 12),   // ukuran subheader (px)
    sub_y:   Number(s.sub_y   || 0),    // naik/turun subheader (px)
  };
}

function ntSaveSettingsToLS(s){
  localStorage.setItem(NT.LS_KEY, JSON.stringify(s));
}

function ntReadSettingsFromUI(){
  return {
    type: ($('#nt_type').value || 'A'),
    bg: ($('#nt_bg').value || 'dark'),
    event: ($('#nt_event').value || '').trim(),
    loc: ($('#nt_loc').value || '').trim(),
    date: ($('#nt_date').value || '').trim(),
    layout: ($('#nt_layout').value || '2up'),

    // ✅ sekarang logo disimpan sebagai DataURL di hidden input
    logo: ($('#nt_logo').value || '').trim(),
    cologo: ($('#nt_cologo').value || '').trim(),

    // ✅ cascading filter di NameTag
    training_type: ($('#nt_training_type')?.value || '').trim(),
    group: ($('#nt_group')?.value || '').trim(),

    name_fs: Number($('#nt_name_fs').value || 44),
    name_y: Number($('#nt_name_y').value || 0),
    photo_s: Number($('#nt_photo_s').value || 160),
    photo_y: Number($('#nt_photo_y').value || 0),

    // ✅ Header adjust
    head_fs: Number($('#nt_head_fs')?.value || 14),
    head_y:  Number($('#nt_head_y')?.value  || 0),
    sub_fs:  Number($('#nt_sub_fs')?.value  || 12),
    sub_y:   Number($('#nt_sub_y')?.value   || 0),
  };
}

function ntApplySettingsToUI(s){
  $('#nt_type').value = s.type;
  $('#nt_bg').value = s.bg;
  $('#nt_event').value = s.event;
  $('#nt_loc').value = s.loc;
  $('#nt_date').value = s.date;
  $('#nt_layout').value = s.layout;

  // ✅ hidden input dataURL
  $('#nt_logo').value = s.logo || '';
  $('#nt_cologo').value = s.cologo || '';

  // info kecil
  const li = $('#nt_logo_info');
  if (li) li.textContent = s.logo ? '✅ Logo terset' : '-';
  const ci = $('#nt_cologo_info');
  if (ci) ci.textContent = s.cologo ? '✅ Co-Logo terset' : '-';

  // ✅ cascading
  if ($('#nt_training_type')) $('#nt_training_type').value = s.training_type || '';
  if ($('#nt_group')) $('#nt_group').value = s.group || '';

  $('#nt_name_fs').value = String(s.name_fs);
  $('#nt_name_y').value  = String(s.name_y);
  $('#nt_photo_s').value = String(s.photo_s);
  $('#nt_photo_y').value = String(s.photo_y);

  // ✅ Header adjust
  if ($('#nt_head_fs')) $('#nt_head_fs').value = String(s.head_fs ?? 14);
  if ($('#nt_head_y'))  $('#nt_head_y').value  = String(s.head_y  ?? 0);
  if ($('#nt_sub_fs'))  $('#nt_sub_fs').value  = String(s.sub_fs  ?? 12);
  if ($('#nt_sub_y'))   $('#nt_sub_y').value   = String(s.sub_y   ?? 0);
}

function ntCardHtml({settings, peserta, photoUrl}){
  const logo = settings.logo ? `<img src="${escapeHtml(settings.logo)}" alt="logo">` : '';
  const cologo = settings.cologo ? `<img src="${escapeHtml(settings.cologo)}" alt="co-logo">` : '';

  const head = `
    <div class="nt-head">
      <div class="nt-logos">${logo}</div>
      <div class="nt-headtxt" style="transform: translateY(var(--nt-head-y));">
        <div class="nt-event" style="font-size: var(--nt-head-fs);">
          ${escapeHtml(settings.event || '-')}
        </div>
        <div class="nt-sub" style="font-size: var(--nt-sub-fs); transform: translateY(var(--nt-sub-y));">
          ${escapeHtml(settings.loc || '-')}${settings.date ? ' • ' + escapeHtml(settings.date) : ''}
        </div>
      </div>
      <div class="nt-logos">${cologo}</div>
    </div>
  `;

  const photo = `
    <div class="nt-photo">
      <img src="${escapeHtml(photoUrl || '')}" alt="photo" onerror="this.style.display='none'">
    </div>
  `;

  return `
    ${head}
    ${settings.type === 'B' ? photo : ''}
    <div class="nt-name">${escapeHtml(peserta?.nama || '-')}</div>
    <div class="nt-foot">NIK: ${escapeHtml(peserta?.nik || '-')} ${peserta?.batch ? ' • ' + escapeHtml(peserta.batch) : ''}</div>
  `;
}

function ntRenderPreview(){
  const s = ntReadSettingsFromUI();
  ntSaveSettingsToLS(s);

  const card = $('#nt_preview');
  if (!card) return;

  // class template + bg
  card.classList.remove('nt-typeA','nt-typeB','nt-bg-dark','nt-bg-green','nt-bg-plain');
  card.classList.add(s.type === 'B' ? 'nt-typeB' : 'nt-typeA');
  card.classList.add(s.bg === 'green' ? 'nt-bg-green' : (s.bg === 'plain' ? 'nt-bg-plain' : 'nt-bg-dark'));

  // css vars adjust
  card.style.setProperty('--nt-name-fs', s.name_fs + 'px');
  card.style.setProperty('--nt-name-y',  s.name_y + 'px');
  card.style.setProperty('--nt-photo-s', s.photo_s + 'px');
  card.style.setProperty('--nt-photo-y', s.photo_y + 'px');

   // ✅ header vars
  card.style.setProperty('--nt-head-fs', s.head_fs + 'px');
  card.style.setProperty('--nt-head-y',  s.head_y + 'px');
  card.style.setProperty('--nt-sub-fs',  s.sub_fs + 'px');
  card.style.setProperty('--nt-sub-y',   s.sub_y + 'px');

  // peserta terpilih
  const it = NT.queue.find(x => x.nik === NT.selectedNik) || NT.queue[0] || { nik:'', nama:'', batch:'' };
  NT.selectedNik = it.nik || '';
  card.innerHTML = ntCardHtml({ settings:s, peserta:it, photoUrl: it.photoUrl });

  // info
  const info = $('#nt_info');
  if (info) info.textContent = `Preview: ${it.nama || '-'} (${it.nik || '-'})`;
}

function ntRenderQueue(){
  const box = $('#nt_queue');
  if (!box) return;

  if (!NT.queue.length){
    box.innerHTML = `<div class="small">Belum ada antrian.</div>`;
    ntUpdateQueueHeader();   // ✅
    ntUpdatePickInfo();      // ✅
    return;
  }

  box.innerHTML = NT.queue.map(x=>`
    <div class="nt-qitem" data-nik="${escapeHtml(x.nik)}" title="Klik untuk preview">
      <div>
        <b>${escapeHtml(x.nama)}</b>
        <div class="mini">${escapeHtml(x.nik)}${x.batch ? ' • '+escapeHtml(x.batch) : ''}</div>
      </div>
      <button class="btn danger" data-del="${escapeHtml(x.nik)}" type="button">Hapus</button>
    </div>
  `).join('');

  // click select
  box.querySelectorAll('.nt-qitem').forEach(el=>{
    el.addEventListener('click', (e)=>{
      const del = e.target?.getAttribute?.('data-del');
      if (del) return; // handled below
      NT.selectedNik = el.dataset.nik;
      ntRenderPreview();
    });
  });

  // delete
  box.querySelectorAll('button[data-del]').forEach(b=>{
    b.addEventListener('click', (e)=>{
      e.stopPropagation();
      const nik = b.dataset.del;
      NT.queue = NT.queue.filter(z=>z.nik !== nik);
      if (NT.selectedNik === nik) NT.selectedNik = (NT.queue[0]?.nik || '');
      ntRenderQueue();
      ntRenderPreview();
    });
  });
  ntUpdateQueueHeader();
  ntUpdatePickInfo();
}

/* =========================================================
   ✅ NAME TAG: LOCAL PICKED (disable tombol Tambah) + INFO REALTIME
   - Semua hanya localStorage (tidak mempengaruhi server)
   ========================================================= */

function ntLoadPickedLocal(){
  try{
    const raw = localStorage.getItem(NT.LS_PICK_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    NT.pickedSet = new Set((arr || []).map(x=>String(x)));
  }catch(e){
    NT.pickedSet = new Set();
  }
}

function ntSavePickedLocal(){
  try{
    localStorage.setItem(NT.LS_PICK_KEY, JSON.stringify([...NT.pickedSet]));
  }catch(e){}
}

function ntPickedCount(){
  return NT.pickedSet ? NT.pickedSet.size : 0;
}

function ntUpdatePickInfo(){
  const el = document.getElementById('nt_pick_info');
  if (!el) return;

  const pickedNiks = [...NT.pickedSet];
  if (!pickedNiks.length){
    el.innerHTML = `Dipilih (local): <b>0</b> • Antrian cetak: <b>${NT.queue.length}</b>`;
    return;
  }

  // tampilkan nama dari lastRows jika ada, fallback ke nik
  const nameOf = (nik)=>{
    const it = (NT.lastRows || []).find(r=>String(r.nik)===String(nik));
    return it?.nama || nik;
  };

  const preview = pickedNiks
    .slice(0, 12)
    .map(nik=>`<span class="chip" style="cursor:default;">${escapeHtml(nameOf(nik))}</span>`)
    .join(' ');

  const more = pickedNiks.length > 12 ? ` <span class="small">(+${pickedNiks.length-12} lagi)</span>` : '';

  el.innerHTML = `
    Dipilih (local): <b>${pickedNiks.length}</b> • Antrian cetak: <b>${NT.queue.length}</b><br/>
    ${preview}${more}
  `;
}

function ntUpdateQueueHeader(){
  // menambahkan info jumlah di area antrian (tanpa ubah struktur besar)
  const box = document.getElementById('nt_queue');
  if (!box) return;

  // kalau sudah ada header count, jangan dobel
  const wrapId = 'nt_queue_count';
  let c = document.getElementById(wrapId);
  if (!c){
    c = document.createElement('div');
    c.id = wrapId;
    c.className = 'small';
    c.style.marginBottom = '8px';
    // sisipkan sebelum list item (di dalam box)
    box.parentElement?.insertBefore(c, box);
  }
  c.innerHTML = `Jumlah nama dalam antrian cetak: <b>${NT.queue.length}</b>`;
}

function ntRefreshAddButtons(){
  // aktif/nonaktifkan tombol Tambah sesuai pickedSet (tanpa reload server)
  const tbody = document.querySelector('#nt_table tbody');
  if (!tbody) return;

  tbody.querySelectorAll('button[data-add]').forEach(btn=>{
    const nik = String(btn.dataset.add || '');
    const disabled = NT.pickedSet.has(nik);
    btn.disabled = disabled;
    btn.classList.toggle('ghost', disabled);
    btn.textContent = disabled ? 'Sudah ditambahkan' : 'Tambah';
  });
}

function ntRenderPesertaTable(rows){
  const table = document.getElementById('nt_table');
  const tbody = table ? table.querySelector('tbody') : null;
  if (!tbody){
    UI.setAdminResult('Elemen tabel peserta (#nt_table tbody) tidak ditemukan di HTML.', false);
    return;
  }

  NT.lastRows = rows || [];

  // render rows
  tbody.innerHTML = (rows || []).map(x=>{
    const nik = String(x.nik);
    const dis = NT.pickedSet.has(nik);
    return `
      <tr>
        <td>${escapeHtml(x.nik)}</td>
        <td>${escapeHtml(x.nama)}</td>
        <td>${escapeHtml(x.batch || '')}</td>
        <td>
          <button class="btn primary" data-add="${escapeHtml(x.nik)}" type="button" ${dis?'disabled':''}>
            ${dis?'Sudah ditambahkan':'Tambah'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // bind add actions
  tbody.querySelectorAll('button[data-add]').forEach(btn=>{
    btn.addEventListener('click', async()=>{
      const nik = String(btn.dataset.add || '');
      const it = (rows || []).find(z => String(z.nik) === nik);
      if (!it) return;

      // ✅ jika sudah picked local, stop (double safety)
      if (NT.pickedSet.has(nik)){
        UI.setAdminResult('Nama ini sudah ditambahkan (local). Gunakan Reset Pilihan jika ingin menambahkan ulang.', false);
        return;
      }

      // ✅ jika sudah ada di queue (double safety)
      if (NT.queue.some(z => String(z.nik) === nik)){
        UI.setAdminResult('Peserta sudah ada di antrian.', false);
        return;
      }

      // ✅ baca setting sekali
      const s = ntReadSettingsFromUI();

      // =========================================================
      // ✅ 1) Tambah ke antrian dulu (INSTAN) tanpa menunggu foto
      // =========================================================
      NT.queue.push({ nik: it.nik, nama: it.nama, batch: it.batch || '', photoUrl: '' });
      if (!NT.selectedNik) NT.selectedNik = it.nik;

      // ✅ set picked local + persist
      NT.pickedSet.add(nik);
      ntSavePickedLocal();

      // ✅ disable tombol langsung biar terasa cepat
      btn.disabled = true;
      btn.classList.add('ghost');
      btn.textContent = 'Sudah ditambahkan';

      // ✅ render minimal yang perlu (sekali)
      ntRenderQueue();
      ntRenderPreview();
      ntUpdateQueueHeader();
      ntUpdatePickInfo();

      UI.setAdminResult(`Ditambahkan ke antrian: ${it.nama}${s.type==='B' ? ' (foto diproses…)':''}`, true);

      // =========================================================
      // ✅ 2) Kalau template B, ambil foto BELAKANGAN (async)
      //     - tidak mengunci UI
      // =========================================================
      if (s.type === 'B'){
        idle(async ()=>{
          try{
            const p = await ntGetPhotoByNik(it.nik); // ini yg lama (GAS/Drive)
            if (p){
              ntUpdatePhotoInQueue(String(it.nik), p);
              // tidak wajib render queue ulang; preview saja cukup
              // jika Anda ingin memastikan kartu print sudah bawa foto:
              // (opsional) ntRenderQueue();
            }
          } catch(e){
            // kalau gagal foto, biarkan saja (nametag tetap bisa dicetak tanpa foto)
          }
        });
      }
    });
  });

  // info bawah tabel (tetap)
  ntUpdatePickInfo();
  ntRefreshAddButtons();
}

function ntUpdatePhotoInQueue(nik, dataUrl){
  nik = String(nik||'');
  const idx = NT.queue.findIndex(z => String(z.nik) === nik);
  if (idx < 0) return;

  NT.queue[idx].photoUrl = dataUrl || '';

  // refresh preview kalau yg sedang dipreview itu orangnya
  if (NT.selectedNik === nik){
    try{ ntRenderPreview(); }catch(e){}
  }
}

function idle(cb){
  // jalankan saat browser senggang supaya UI tetap ringan
  if (window.requestIdleCallback) return requestIdleCallback(()=>cb(), { timeout: 1200 });
  return setTimeout(cb, 0);
}

/* --- Ambil foto dari Drive via GAS (folder ID Anda) --- */
async function ntGetPhotoByNik(nik){
  nik = String(nik||'').trim();
  if (!nik) return '';

  if (NT.photoCache[nik]) return NT.photoCache[nik];

  // butuh login admin (karena akses drive / data peserta)
  if (!isAdminSessionValid()) return '';

  const r = await api('adminGetPhotoByNik', {
    admin_token: State.adminToken,
    nik
  });

  if (r.ok && r.dataUrl){
    NT.photoCache[nik] = r.dataUrl;
    return r.dataUrl;
  }
  return '';
}

/* --- Load peserta terfilter dari server --- */
async function ntLoadPeserta(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');

  // helper aman ambil value dari element yang mungkin tidak ada
  const val = (...ids) => {
    for (const id of ids){
      const el = document.getElementById(id);
      if (el && typeof el.value !== 'undefined') return String(el.value || '').trim();
    }
    return '';
  };

  // ✅ ambil dari UI (support jika id batch Anda ternyata berbeda)
  const training_type = val('nt_training_type');
  const group = val('nt_group', 'nt_batch');   // fallback kalau ternyata id-nya nt_batch
  const q = val('nt_q');

  if (!training_type || !group){
    UI.setAdminResult('Pilih Training Type dan Batch terlebih dahulu.', false);
    return;
  }

  const r = await api('adminPesertaList', {
    admin_token: State.adminToken,
    training_type,
    group,
    q,
    limit: 300
  });

  if (!r.ok) throw new Error(r.error || 'Gagal muat peserta');

  // ✅ pastikan tabel ada
  const table = document.getElementById('nt_table');
  const tbody = table ? table.querySelector('tbody') : null;
  if (!tbody){
    UI.setAdminResult('Elemen tabel peserta (#nt_table tbody) tidak ditemukan di HTML.', false);
    return;
  }

  const rows = r.items || [];
  ntRenderPesertaTable(rows);
    
  const info = document.getElementById('nt_info');
  if (info) info.textContent = `Peserta loaded: ${rows.length}`;
}

function ntBuildDummyCards(count){
  if (count <= 0) return '';
  return Array.from({ length: count }).map(() => `
    <div class="nt-card nt-dummy"></div>
  `).join('');
}

/* --- Print A4 via window.print (Save as PDF) --- */
function ntOpenPrintWindow(){
  const s = ntReadSettingsFromUI();
  if (!NT.queue.length){
    UI.setAdminResult('Antrian kosong. Tambahkan peserta dulu.', false);
    return;
  }

  const LAYOUT = (State.cfg && State.cfg.nametag_layouts) ? State.cfg.nametag_layouts : ntDefaultLayouts();

  const layKey = String(s.layout || '2up');
  const lay = LAYOUT[layKey] || LAYOUT['2up'] || { per:2, cols:1, pad:10, gap:8 };

  const perPage  = Number(lay.per || 2);
  const sheetPad = Number(lay.pad || 10);
  const gridGap  = Number(lay.gap || 8);
  const cols     = Number(lay.cols || 1);

  // ✅ grid A4
  const gridCss = `grid-template-columns: repeat(${cols}, 1fr); grid-auto-rows: 1fr; gap: ${gridGap}mm;`;

  // ✅ kartu isi penuh cell (rapat, tidak ada whitespace)
  const cardHeight = '100%';

  const cards = NT.queue.map(p=>{
    return `
      <div class="nt-card ${s.type==='B'?'nt-typeB':'nt-typeA'} ${s.bg==='green'?'nt-bg-green':(s.bg==='plain'?'nt-bg-plain':'nt-bg-dark')}"
        style="
          --nt-name-fs:${s.name_fs}px;
          --nt-name-y:${s.name_y}px;
          --nt-photo-s:${s.photo_s}px;
          --nt-photo-y:${s.photo_y}px;

          --nt-head-fs:${s.head_fs}px;
          --nt-head-y:${s.head_y}px;
          --nt-sub-fs:${s.sub_fs}px;
          --nt-sub-y:${s.sub_y}px;

          width: 100%;
          height: ${cardHeight};
          page-break-inside: avoid;
        ">
        ${ntCardHtml({ settings:s, peserta:p, photoUrl:p.photoUrl })}
      </div>
    `;
  });

  // paging
  let pages = [];
  for (let i = 0; i < cards.length; i += perPage){
    const slice = cards.slice(i, i + perPage);
    const remainder = slice.length % perPage;
    const dummyCount = remainder === 0 ? 0 : (perPage - remainder);

    const filledChunk =
      slice.join('') +
      ntBuildDummyCards(dummyCount);

    pages.push(`
      <div class="print-sheet"
        style="width:210mm;height:297mm;padding:${sheetPad}mm;box-sizing:border-box;">
        <div style="display:grid; ${gridCss} height:100%;">
          ${filledChunk}
        </div>
      </div>
    `);
  }

  const w = window.open('', '_blank');
  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Name Tag Print</title>
  <style>
    @page { size: A4; margin: 0; }
    body { margin:0; font-family: Inter, Arial, sans-serif; background:#fff; }

    /* CSS Anda tetap sama di bawah ini */
    .nt-card{ border-radius:18px; border:2px solid rgba(0,0,0,.12); overflow:hidden; position:relative; background:#0b1220; }
    .nt-bg-dark{
      background:
        radial-gradient(circle at 20% 25%, rgba(99,102,241,.22), transparent 45%),
        radial-gradient(circle at 80% 20%, rgba(139,92,246,.20), transparent 45%),
        radial-gradient(circle at 40% 80%, rgba(6,182,212,.14), transparent 50%),
        #0b1220;
      color:#fff;
    }
    .nt-bg-green{
      background:
        radial-gradient(circle at 20% 20%, rgba(34,197,94,.18), transparent 48%),
        radial-gradient(circle at 80% 25%, rgba(16,185,129,.18), transparent 45%),
        radial-gradient(circle at 50% 80%, rgba(132,204,22,.12), transparent 55%),
        #062214;
      color:#fff;
    }
    .nt-bg-plain{ background:#111827; color:#fff; }

    .nt-head{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; background: rgba(255,255,255,.10); }
    .nt-logos{ display:flex; align-items:center; gap:10px; min-width: 70px; }
    .nt-logos img{ height: 34px; width:auto; border-radius:8px; background: rgba(255,255,255,.10); padding:4px; }
    .nt-headtxt{ flex:1; text-align:center; line-height:1.2; }
    .nt-event{ font-weight:900; font-size:15px; }
    .nt-sub{ font-weight:800; font-size:13px; opacity:.9; }

    .nt-name{
      position:absolute; left:22px; right:22px; top: 120px;
      transform: translateY(var(--nt-name-y));
      font-weight:900; font-size: var(--nt-name-fs);
      line-height:1.05; text-align:center;
      text-shadow: 0 10px 26px rgba(0,0,0,.45);
    }

    .nt-photo{
      position:absolute; left:50%; top:120px;
      transform: translate(-50%, calc(-50% + var(--nt-photo-y)));
      width: var(--nt-photo-s); height: var(--nt-photo-s);
      border-radius:999px; overflow:hidden;
      border: 4px solid rgba(255,255,255,.25);
      background: rgba(255,255,255,.10);
    }
    .nt-photo img{ width:100%; height:100%; object-fit:cover; }
    .nt-typeA .nt-photo{ display:none; }

    .nt-foot{
      position:absolute; left:0; right:0; bottom:0;
      padding: 10px 14px;
      background: rgba(0,0,0,.25);
      text-align:center;
      font-weight:800;
      font-size:12px;
      border-top: 1px solid rgba(255,255,255,.12);
    }
    
    .nt-dummy{
    visibility: hidden;       /* tidak terlihat */
    border: none !important;
    background: transparent !important;
  }

  </style>
</head>
<body>
  ${pages.join('')}
  <script>
    window.onload = () => setTimeout(()=>window.print(), 250);
  </script>
</body>
</html>
  `;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* --- Send event settings to server (optional log) --- */
async function ntSendSettingsToServer(){
  if (!isAdminSessionValid()) throw new Error('Sesi admin habis. Login ulang.');
  const s = ntReadSettingsFromUI();
  const r = await api('adminNameTagSaveEvent', { admin_token: State.adminToken, settings: s });
  if (!r.ok) throw new Error(r.error || 'Gagal kirim setting');
  return r;
}

function initNameTag(){
  // restore settings
  const s = ntLoadSettings();
  ntApplySettingsToUI(s);
  ntApplySliderBoundsFromCfg();

  ntLoadPickedLocal();       // ✅
  ntUpdatePickInfo();        // ✅

  // ✅ bind file pickers -> dataURL
  const logoFile = $('#nt_logo_file');
  const cologoFile = $('#nt_cologo_file');

  logoFile?.addEventListener('change', async()=>{
    const f = logoFile.files && logoFile.files[0];
    if (!f) return;
    const dataUrl = await fileToDataURL(f);
    $('#nt_logo').value = dataUrl;
    $('#nt_logo_info').textContent = `✅ Logo: ${f.name}`;
    ntRenderPreview();
  });

  cologoFile?.addEventListener('change', async()=>{
    const f = cologoFile.files && cologoFile.files[0];
    if (!f) return;
    const dataUrl = await fileToDataURL(f);
    $('#nt_cologo').value = dataUrl;
    $('#nt_cologo_info').textContent = `✅ Co-Logo: ${f.name}`;
    ntRenderPreview();
  });

  $('#btn-nt-logo-clear')?.addEventListener('click', ()=>{
    if (logoFile) logoFile.value = '';
    $('#nt_logo').value = '';
    $('#nt_logo_info').textContent = '-';
    ntRenderPreview();
  });

  $('#btn-nt-cologo-clear')?.addEventListener('click', ()=>{
    if (cologoFile) cologoFile.value = '';
    $('#nt_cologo').value = '';
    $('#nt_cologo_info').textContent = '-';
    ntRenderPreview();
  });

  // ✅ cascading filter NameTag: TrainingType -> Batch
  const ttEl = $('#nt_training_type');
  const grpEl = $('#nt_group');

  try{
    const meta = State._dashMeta || {};
    const trainingTypes = (meta.jenis_pelatihan || meta.training_types || []);
    fillSelect(ttEl, trainingTypes, 'Pilih Training Type…');

    const refreshNTGroups = ()=>{
      const tt = (ttEl?.value || '').trim();
      const groupsByType = meta.groups_by_training_type || {};
      const groups = tt ? (groupsByType[tt] || []) : (meta.groups || []);
      fillSelect(grpEl, groups, 'Pilih Batch…');

      // kalau sebelumnya tersimpan group yang tidak ada di TT baru, otomatis kosong
      const cur = (grpEl.value || '').trim();
      if (cur && !(groups || []).includes(cur)) grpEl.value = '';
    };

    ttEl?.addEventListener('change', ()=>{
      refreshNTGroups();
      ntRenderPreview();
    });

    grpEl?.addEventListener('change', ()=> ntRenderPreview());

    // initial
    refreshNTGroups();

    // restore saved tt/group if exist
    if (s.training_type && ttEl) ttEl.value = s.training_type;
    refreshNTGroups();
    if (s.group && grpEl) grpEl.value = s.group;

  } catch(e){}

  // listeners common
  const rerender = ()=> ntRenderPreview();

  ['nt_type','nt_bg','nt_event','nt_loc','nt_date','nt_layout'].forEach(id=>{
    $('#'+id)?.addEventListener('change', rerender);
    $('#'+id)?.addEventListener('input', rerender);
  });

  ['nt_name_fs','nt_name_y','nt_photo_s','nt_photo_y','nt_head_fs','nt_head_y','nt_sub_fs','nt_sub_y'].forEach(id=>{
  $('#'+id)?.addEventListener('input', rerender);
  });

  $('#btn-nt-save')?.addEventListener('click', ()=>{
    const s2 = ntReadSettingsFromUI();
    ntSaveSettingsToLS(s2);
    $('#nt_info').textContent = '✅ Setting tersimpan di perangkat.';
    UI.setAdminResult('Setting name tag tersimpan.', true);
    ntRenderPreview();
  });

  $('#btn-nt-send')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-nt-send'),
    async()=>{
      const r = await ntSendSettingsToServer();
      UI.setAdminResult('Setting name tag terkirim ke server.', true);
      $('#nt_info').textContent = '✅ Terkirim: ' + (r.message || 'OK');
    },
    { text:'Mengirim…', overlay:true, overlayText:'Mengirim setting name tag…' }
  ));

  $('#btn-nt-load')?.addEventListener('click', ()=> Busy.wrap(
    $('#btn-nt-load'),
    async()=> await ntLoadPeserta(),
    { text:'Memuat…', overlay:true, overlayText:'Memuat daftar peserta…' }
  ));

  $('#btn-nt-clear')?.addEventListener('click', ()=>{
      NT.queue = [];
      NT.selectedNik = '';
      ntRenderQueue();
      ntRenderPreview();

      // ✅ tombol tambah tetap disable (karena pickedSet tidak dihapus)
    ntUpdateQueueHeader();
    ntUpdatePickInfo();
    ntRefreshAddButtons();
    UI.setAdminResult('Antrian cetak dikosongkan. Status pilihan (local) tetap tersimpan.', true);
    });

    $('#btn-nt-resetlocal')?.addEventListener('click', ()=>{
    if (!confirm('Reset Pilihan akan mengaktifkan kembali tombol "Tambah" (local). Lanjutkan?')) return;

    NT.pickedSet = new Set();
    ntSavePickedLocal();

    // queue boleh tetap atau ikut kosong? requirement hanya reset pilihan.
    // Saya biarkan queue tetap ada; jika mau ikut kosongkan, tinggal set NT.queue=[]
    ntRefreshAddButtons();
    ntUpdatePickInfo();

    UI.setAdminResult('Reset Pilihan berhasil. Tombol "Tambah" aktif kembali (local).', true);
  });

  $('#btn-nt-print')?.addEventListener('click', ()=>{
    ntOpenPrintWindow();
  });

  // first render
  ntRenderQueue();
  ntRenderPreview();
}

