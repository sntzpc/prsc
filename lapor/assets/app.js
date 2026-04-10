
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwvCl43oFLFfVtR1g3vlgviz4xZq67Re4M65cBpLL5_lk6g8GEXHpZujp1y8W1qBI4n/exec';
const SAMPLE_DATA_URL = './data/sample-db.json';
const SPREADSHEET_ID = '18JkzFJHC6q1mfSzeyErH96dhBWMVQJDw4Fd6Oj8lgqQ';
const CACHE_KEY = 'presensi-cache-meta-v1';
const DB_NAME = 'presensi-report-db';
const STORE_NAME = 'datasets';
const DEFAULT_THEME = 'light';
const PARTICIPANT_FIELDS = ['nik', 'nama', 'jenis_pelatihan', 'tahun', 'lokasi_ojt', 'unit', 'region', 'group'];

const state = {
  raw: null,
  rendered: null,
  source: '-',
  holidayMap: new Map(),
};

const $ = (id) => document.getElementById(id);
const monthInput = $('monthInput');
const startDateInput = $('startDateInput');
const endDateInput = $('endDateInput');
const titleSourceField = $('titleSourceField');
const participantFilters = $('participantFilters');
const reportTable = $('reportTable');

const dbPromise = idb.openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME);
    }
  }
});

function setProgress(percent, text = '') {
  $('progressBar').style.width = `${percent}%`;
  $('progressLabel').textContent = `${Math.round(percent)}%`;
  if (text) $('statusText').textContent = text;
}

function setCacheBadge(text) {
  $('cacheBadge').textContent = text;
}

function saveTheme(theme) {
  localStorage.setItem('presensi-theme', theme);
}
function getTheme() {
  return localStorage.getItem('presensi-theme') || DEFAULT_THEME;
}
function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme !== 'dark');
  $('themeToggle').textContent = theme === 'dark' ? '🌙 Dark' : '🌞 Light';
  saveTheme(theme);
}

function parseLocalDateParts(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return {
      y: value.getFullYear(),
      m: value.getMonth() + 1,
      d: value.getDate(),
      hh: value.getHours(),
      mm: value.getMinutes(),
      ss: value.getSeconds()
    };
  }
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const yRaw = Number(m[3]);
    const y = yRaw < 100 ? (yRaw >= 70 ? 1900 + yRaw : 2000 + yRaw) : yRaw;
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    const hasTime = /\s+\d{1,2}:\d{2}/.test(s);

    let d, mo;
    if (hasTime) {
      // attendance dari GAS akan dikirim sebagai dd/MM/yyyy HH:mm:ss
      d = a; mo = b;
    } else if (a > 12 && b <= 12) {
      d = a; mo = b;
    } else if (b > 12 && a <= 12) {
      mo = a; d = b;
    } else {
      // default untuk format lokal Indonesia
      d = a; mo = b;
    }

    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return { d, m: mo, y, hh, mm, ss };
    }
  }

  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const yRaw = Number(m[3]);
    const y = yRaw < 100 ? (yRaw >= 70 ? 1900 + yRaw : 2000 + yRaw) : yRaw;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return {
        d,
        m: mo,
        y,
        hh: Number(m[4] || 0),
        mm: Number(m[5] || 0),
        ss: Number(m[6] || 0)
      };
    }
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return {
      y: Number(m[1]),
      m: Number(m[2]),
      d: Number(m[3]),
      hh: Number(m[4] || 0),
      mm: Number(m[5] || 0),
      ss: Number(m[6] || 0)
    };
  }

  return null;
}

function partsToISO(parts) {
  if (!parts) return '';
  return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
}

function compareDateTimeParts(a, b) {
  const ka = [a.y, a.m, a.d, a.hh || 0, a.mm || 0, a.ss || 0];
  const kb = [b.y, b.m, b.d, b.hh || 0, b.mm || 0, b.ss || 0];
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

function toISODate(value) {
  const parts = parseLocalDateParts(value);
  return partsToISO(parts);
}

function fmtTime(value) {
  const parts = parseLocalDateParts(value);
  if (parts) return `${String(parts.hh || 0).padStart(2, '0')}.${String(parts.mm || 0).padStart(2, '0')}`;

  const s = String(value || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2]}`;
  m = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2]}`;
  return '';
}
function fmtDateLong(isoDate) {
  const [y, m, d] = String(isoDate || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtMonthYear(isoDate) {
  const [y, m] = String(isoDate || '').split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();
}
function fileDateStamp() {
  const d = new Date();
  const parts = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ];
  return parts.join('');
}
function periodLabel(dateList) {
  if (!dateList.length) return 'SEMUA PERIODE';
  if (monthInput.value) {
    const [year, month] = monthInput.value.split('-');
    return new Date(`${year}-${month}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();
  }
  return `${fmtDateLong(dateList[0]).toUpperCase()} s/d ${fmtDateLong(dateList[dateList.length - 1]).toUpperCase()}`;
}
function sanitizeFilename(name) {
  return name.replace(/[^\w\d_-]+/g, '_');
}
function capitalizeWords(value) {
  return String(value || '').replace(/\b\w/g, c => c.toUpperCase());
}

async function saveDataset(dataset) {
  const db = await dbPromise;
  await db.put(STORE_NAME, dataset, 'main');
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    savedAt: new Date().toISOString(),
    rows: dataset?.sheets?.attendance?.length || 0
  }));
}
async function readDataset() {
  const db = await dbPromise;
  return db.get(STORE_NAME, 'main');
}
async function clearLocalData() {
  const db = await dbPromise;
  await db.clear(STORE_NAME);
  localStorage.removeItem(CACHE_KEY);
}

function updateCacheInfo() {
  const meta = localStorage.getItem(CACHE_KEY);
  if (!meta) {
    setCacheBadge('Belum ada cache');
    return;
  }
  try {
    const parsed = JSON.parse(meta);
    const when = new Date(parsed.savedAt).toLocaleString('id-ID');
    setCacheBadge(`Cache lokal: ${parsed.rows} baris, ${when}`);
  } catch {
    setCacheBadge('Cache lokal tersedia');
  }
}

function buildFilterControls(participants) {
  participantFilters.innerHTML = '';
  const filters = PARTICIPANT_FIELDS.map((field) => {
    const values = [...new Set(participants.map(item => item[field]).filter(v => v !== undefined && v !== null && v !== ''))]
      .sort((a, b) => String(a).localeCompare(String(b), 'id'));
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <label class="label">${capitalizeWords(field.replaceAll('_', ' '))}</label>
      <select class="input participant-filter" data-field="${field}">
        <option value="">Semua</option>
        ${values.map(v => `<option value="${String(v).replaceAll('"', '&quot;')}">${v}</option>`).join('')}
      </select>
    `;
    return wrapper;
  });
  filters.forEach(el => participantFilters.appendChild(el));

  titleSourceField.innerHTML = PARTICIPANT_FIELDS
    .map(field => `<option value="${field}" ${field === 'group' ? 'selected' : ''}>${capitalizeWords(field.replaceAll('_', ' '))}</option>`)
    .join('');
}


function getCI(obj, keys) {
  if (!obj) return '';
  const map = {};
  Object.keys(obj).forEach(k => map[String(k).toLowerCase()] = obj[k]);
  for (const key of keys) {
    const hit = map[String(key).toLowerCase()];
    if (hit !== undefined && hit !== null) return hit;
  }
  return '';
}

function normalizeDataset(raw) {
  const sheets = raw?.sheets || raw || {};
  const peserta = (sheets.peserta || []).map(item => {
    const obj = {};
    PARTICIPANT_FIELDS.forEach(field => obj[field] = getCI(item, [field]) ?? '');
    obj.nik = String(obj.nik ?? '').trim();
    obj.nama = String(obj.nama ?? '').trim();
    return obj;
  }).filter(item => item.nik);

  const attendance = (sheets.attendance || []).map(item => ({
    timestamp: getCI(item, ['timestamp', 'waktu', 'tanggal', 'datetime']),
    nik: String(getCI(item, ['nik']) ?? '').trim(),
    nama: getCI(item, ['nama']),
    mode: getCI(item, ['mode']),
    training_type: getCI(item, ['training_type', 'jenis_pelatihan']),
    activity: getCI(item, ['activity']),
    material: getCI(item, ['material']),
    gate_reason: getCI(item, ['gate_reason']),
    gate_direction: getCI(item, ['gate_direction', 'arah']),
    status: getCI(item, ['status'])
  })).filter(item => item.timestamp && item.nik);

  const holidays = (sheets.holidays || []).map(item => ({
    tanggal: toISODate(getCI(item, ['tanggal', 'date', 'libur', 'holiday_date'])),
    keterangan: getCI(item, ['keterangan', 'description', 'holiday']) || 'Hari libur'
  })).filter(item => item.tanggal);

  return { peserta, attendance, holidays };
}

function buildHolidayMap(holidays) {

  const map = new Map();
  holidays.forEach(item => map.set(item.tanggal, item.keterangan));
  return map;
}

function makeDateRange(startIso, endIso) {
  if (!startIso || !endIso) return [];
  const out = [];
  const cur = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function getDateRangeFromFilters(allDates) {
  const sorted = [...allDates].sort();

  // Jika user memilih rentang tanggal tertentu, tampilkan penuh sesuai rentang itu.
  if (startDateInput.value || endDateInput.value) {
    const start = startDateInput.value || sorted[0];
    const end = endDateInput.value || sorted[sorted.length - 1];
    if (!start || !end) return [];
    return makeDateRange(start, end);
  }

  // Jika user memilih bulan, tampilkan 1 bulan penuh meskipun ada tanggal tanpa data.
  if (monthInput.value) {
    const [year, month] = monthInput.value.split('-').map(Number);
    if (!year || !month) return [];
    const lastDay = new Date(year, month, 0).getDate();
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return makeDateRange(start, end);
  }

  if (!sorted.length) return [];
  return sorted;
}

function filterParticipants(rows) {
  const selects = [...document.querySelectorAll('.participant-filter')];
  return rows.filter(item => selects.every(select => {
    const field = select.dataset.field;
    const value = select.value;
    if (!value) return true;
    return String(item[field] ?? '') === value;
  }));
}


function buildRenderedData() {
  if (!state.raw) return null;
  setProgress(56, 'Menerapkan filter peserta dan periode...');
  const participantRows = filterParticipants(state.raw.peserta);
  const participantMap = new Map(participantRows.map(item => [String(item.nik), item]));

  const allDates = new Set();
  const attendanceByNikDate = new Map();

  const relevantAttendance = state.raw.attendance.filter(item => participantMap.has(String(item.nik)));
  relevantAttendance.forEach(item => {
    const isoDate = toISODate(item.timestamp);
    if (!isoDate) return;
    allDates.add(isoDate);
    const key = `${item.nik}__${isoDate}`;
    if (!attendanceByNikDate.has(key)) attendanceByNikDate.set(key, []);
    attendanceByNikDate.get(key).push(item);
  });

  let dateList = getDateRangeFromFilters([...allDates]);
  if (!dateList.length && !monthInput.value && !startDateInput.value && !endDateInput.value) {
    dateList = [...allDates].sort();
  }

  setProgress(72, 'Menyusun grid laporan...');
  const rows = participantRows.map((peserta, index) => {
    const daily = {};
    dateList.forEach(date => {
      const records = [...(attendanceByNikDate.get(`${peserta.nik}__${date}`) || [])]
        .sort((a, b) => compareDateTimeParts(parseLocalDateParts(a.timestamp) || {}, parseLocalDateParts(b.timestamp) || {}));

      const ins = records.filter(r => String(r.gate_direction || '').toUpperCase() === 'IN');
      const outs = records.filter(r => String(r.gate_direction || '').toUpperCase() === 'OUT');

      // Logika final:
      // - Masuk  = timestamp pertama dengan gate_direction IN.
      // - Keluar = timestamp pertama dengan gate_direction OUT.
      // - Jika tidak ada IN/OUT yang sesuai, jangan pakai record lain sebagai fallback silang.
      const masuk = ins[0]?.timestamp || '';
      const keluar = outs[0]?.timestamp || '';

      daily[date] = {
        masuk: fmtTime(masuk),
        keluar: fmtTime(keluar),
        totalRecords: records.length
      };
    });
    return {
      no: index + 1,
      ...peserta,
      daily
    };
  });

  const titleField = titleSourceField.value || 'group';
  const uniqueProgram = [...new Set(rows.map(item => item[titleField]).filter(Boolean))];
  const titleProgram = uniqueProgram.length === 1 ? uniqueProgram[0] : (uniqueProgram[0] ? `${uniqueProgram[0]} + lainnya` : 'SEMUA PROGRAM');
  const title = `LAPORAN HARIAN ABSENSI PESERTA ${String(titleProgram).toUpperCase()} PERIODE ${periodLabel(dateList)}`;

  return { rows, dateList, titleProgram, title, titleField };
}

function isHolidayColumn(isoDate) {

  const [y, m, d] = String(isoDate || '').split('-').map(Number);
  if (!y || !m || !d) return false;
  const isSunday = new Date(y, m - 1, d).getDay() === 0;
  return isSunday || state.holidayMap.has(isoDate);
}

function renderTable(rendered) {
  if (!rendered) return;
  setProgress(88, 'Merender tabel...');
  const { rows, dateList, title } = rendered;
  $('reportTitle').textContent = title;
  $('reportSubtitle').textContent = dateList.length
    ? `${dateList[0]} s/d ${dateList[dateList.length - 1]} • ${rows.length} peserta`
    : 'Tidak ada tanggal pada filter saat ini.';

  const topHead = [];
  const subHead = [];
  topHead.push('<tr>');
  subHead.push('<tr>');
  const fixedHeaders = [
    { key: 'no', label: 'No', sticky: 'sticky-col' },
    { key: 'nik', label: 'NIK', sticky: 'sticky-col-2' },
    { key: 'nama', label: 'Nama', sticky: 'sticky-col-3' },
    { key: 'jenis_pelatihan', label: 'Program' },
    { key: 'unit', label: 'Unit' },
    { key: 'region', label: 'Region' }
  ];
  fixedHeaders.forEach(head => {
    topHead.push(`<th rowspan="2" class="${head.sticky || ''}">${head.label}</th>`);
  });

  dateList.forEach(date => {
    const [yy, mm, dd] = date.split('-').map(Number);
    const d = new Date(yy, mm - 1, dd);
    const holidayClass = isHolidayColumn(date) ? 'holiday' : '';
    const dayLabel = d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' });
    const weekDay = d.toLocaleDateString('id-ID', { weekday: 'short' });
    topHead.push(`<th colspan="2" class="${holidayClass}"><div class="font-semibold">${dayLabel}</div><div class="subhead">${weekDay}</div></th>`);
    subHead.push(`<th class="${holidayClass}">Masuk</th><th class="${holidayClass}">Keluar</th>`);
  });
  topHead.push('</tr>');
  subHead.push('</tr>');

  const body = rows.map(item => {
    const base = [
      `<td class="sticky-col text-center font-semibold">${item.no}</td>`,
      `<td class="sticky-col-2 font-medium">${item.nik}</td>`,
      `<td class="sticky-col-3">${item.nama}</td>`,
      `<td>${item.jenis_pelatihan || ''}</td>`,
      `<td>${item.unit || ''}</td>`,
      `<td>${item.region || ''}</td>`
    ];
    dateList.forEach(date => {
      const holidayClass = isHolidayColumn(date) ? 'holiday' : '';
      base.push(`<td class="${holidayClass} text-center">${item.daily[date]?.masuk || ''}</td>`);
      base.push(`<td class="${holidayClass} text-center">${item.daily[date]?.keluar || ''}</td>`);
    });
    return `<tr>${base.join('')}</tr>`;
  }).join('');

  reportTable.innerHTML = `<thead>${topHead.join('')}${subHead.join('')}</thead><tbody>${body}</tbody>`;

  $('summaryParticipants').textContent = rows.length;
  $('summaryDates').textContent = dateList.length;
  $('summaryProgram').textContent = rendered.titleProgram || '-';
  $('summarySource').textContent = state.source;
}

async function fetchFromGas() {
  const url = `${GAS_URL}?spreadsheetId=${encodeURIComponent(SPREADSHEET_ID)}&include=peserta,attendance,holidays,training_meta`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchDataset() {
  setProgress(10, 'Memeriksa cache lokal...');
  const cached = await readDataset();
  if (cached) {
    state.source = 'Cache lokal (IndexedDB)';
    updateCacheInfo();
  }

  try {
    setProgress(24, 'Mengambil data dari Google Apps Script...');
    const raw = await fetchFromGas();
    await saveDataset(raw);
    state.source = 'Google Apps Script';
    updateCacheInfo();
    return raw;
  } catch (error) {
    console.warn('Gagal dari GAS, fallback cache/sample', error);
    if (cached) return cached;
    setProgress(24, 'GAS gagal, memuat data sample lokal...');
    const response = await fetch(SAMPLE_DATA_URL);
    const raw = await response.json();
    state.source = 'Sample lokal';
    updateCacheInfo();
    return raw;
  }
}

async function hydrateAndRender() {
  const raw = await fetchDataset();
  setProgress(42, 'Menormalisasi data...');
  state.raw = normalizeDataset(raw);
  state.holidayMap = buildHolidayMap(state.raw.holidays);
  buildFilterControls(state.raw.peserta);
  state.rendered = buildRenderedData();
  renderTable(state.rendered);
  setProgress(100, 'Selesai.');
}

function reRenderOnly() {
  setProgress(60, 'Memproses ulang laporan...');
  state.rendered = buildRenderedData();
  renderTable(state.rendered);
  setProgress(100, 'Filter diterapkan.');
}

function getHolidayLegend(date) {
  const desc = state.holidayMap.get(date);
  if (desc) return desc;
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (y && m && d && new Date(y, m - 1, d).getDay() === 0) return 'Minggu';
  return '';
}

function exportXlsx() {
  if (!state.rendered) return alert('Data belum tersedia.');
  setProgress(20, 'Menyiapkan file XLSX...');
  const { rows, dateList, title } = state.rendered;

  const wsData = [];
  wsData.push([title]);
  wsData.push([`Dicetak: ${new Date().toLocaleString('id-ID')}`]);
  const head1 = ['No', 'NIK', 'Nama', 'Program', 'Unit', 'Region'];
  const head2 = ['', '', '', '', '', ''];
  dateList.forEach(date => {
    head1.push(date, null);
    head2.push('Masuk', 'Keluar');
  });
  wsData.push(head1);
  wsData.push(head2);

  rows.forEach(row => {
    const line = [row.no, row.nik, row.nama, row.jenis_pelatihan || '', row.unit || '', row.region || ''];
    dateList.forEach(date => {
      line.push(row.daily[date]?.masuk || '', row.daily[date]?.keluar || '');
    });
    wsData.push(line);
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(5, 5 + (dateList.length * 2)) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(5, 5 + (dateList.length * 2)) } },
    ...dateList.map((_, idx) => ({
      s: { r: 2, c: 6 + (idx * 2) },
      e: { r: 2, c: 7 + (idx * 2) }
    }))
  ];
  ws['!cols'] = [
    { wch: 6 }, { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 12 },
    ...dateList.flatMap(() => [{ wch: 8 }, { wch: 8 }])
  ];

  // styling
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = 0; c <= range.e.c; c++) {
    const titleCell = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[titleCell]) ws[titleCell].s = { font: { bold: true, sz: 16 }, alignment: { horizontal: 'center' } };
    const subtitleCell = XLSX.utils.encode_cell({ r: 1, c });
    if (ws[subtitleCell]) ws[subtitleCell].s = { alignment: { horizontal: 'center' } };
  }
  for (let c = 0; c <= range.e.c; c++) {
    [2, 3].forEach(r => {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) return;
      ws[addr].s = {
        font: { bold: true },
        alignment: { horizontal: 'center', vertical: 'center' },
        fill: { fgColor: { rgb: 'E2E8F0' } }
      };
    });
  }

  dateList.forEach((date, idx) => {
    if (!isHolidayColumn(date)) return;
    const startCol = 6 + idx * 2;
    for (let r = 2; r <= range.e.r; r++) {
      for (let c = startCol; c <= startCol + 1; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = Object.assign({}, ws[addr].s || {}, {
          fill: { fgColor: { rgb: 'FECACA' } }
        });
      }
    }
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  const filename = `Laporan_Harian_Absensi_${fileDateStamp()}.xlsx`;
  XLSX.writeFile(wb, filename, { cellStyles: true });
  setProgress(100, 'File XLSX berhasil diunduh.');
}

function exportPdf() {
  if (!state.rendered) return alert('Data belum tersedia.');
  setProgress(20, 'Menyiapkan file PDF...');
  const { rows, dateList, title } = state.rendered;
  const { jsPDF } = window.jspdf;

  // Ukuran kertas fleksibel agar seluruh kolom dan baris muat dalam satu halaman.
  const fixedColWidths = [26, 60, 120, 80, 50, 55];
  const dynamicColWidth = 32; // per kolom Masuk/Keluar
  const tableWidth = fixedColWidths.reduce((a, b) => a + b, 0) + (dateList.length * 2 * dynamicColWidth);
  const pageWidth = Math.max(842, tableWidth + 60); // margin kiri-kanan
  const rowHeight = 16;
  const headerHeight = 56;
  const titleBlock = 70;
  const footerPad = 30;
  const pageHeight = Math.max(595, titleBlock + headerHeight + (rows.length * rowHeight) + footerPad);

  const doc = new jsPDF({
    unit: 'pt',
    format: [pageWidth, pageHeight],
    orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait'
  });

  doc.setFontSize(16);
  doc.text(title, pageWidth / 2, 28, { align: 'center' });
  doc.setFontSize(10);
  doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, 30, 48);

  const head = [
    [
      { content: 'No', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'NIK', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Nama', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Program', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Unit', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      { content: 'Region', rowSpan: 2, styles: { halign: 'center', valign: 'middle' } },
      ...dateList.flatMap(date => ([
        {
          content: `${new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' })}
${new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short' })}`,
          colSpan: 2,
          styles: {
            halign: 'center',
            valign: 'middle',
            fillColor: isHolidayColumn(date) ? [254, 202, 202] : [226, 232, 240]
          }
        }
      ]))
    ],
    [
      ...dateList.flatMap(date => ([
        { content: 'Masuk', styles: { halign: 'center', valign: 'middle', fillColor: isHolidayColumn(date) ? [254, 202, 202] : [241, 245, 249] } },
        { content: 'Keluar', styles: { halign: 'center', valign: 'middle', fillColor: isHolidayColumn(date) ? [254, 202, 202] : [241, 245, 249] } }
      ]))
    ]
  ];

  const body = rows.map(row => [
    row.no,
    row.nik,
    row.nama,
    row.jenis_pelatihan || '',
    row.unit || '',
    row.region || '',
    ...dateList.flatMap(date => [row.daily[date]?.masuk || '', row.daily[date]?.keluar || ''])
  ]);

  const columnStyles = {
    0: { cellWidth: fixedColWidths[0], halign: 'center' },
    1: { cellWidth: fixedColWidths[1] },
    2: { cellWidth: fixedColWidths[2] },
    3: { cellWidth: fixedColWidths[3] },
    4: { cellWidth: fixedColWidths[4] },
    5: { cellWidth: fixedColWidths[5] }
  };
  for (let i = 0; i < dateList.length * 2; i++) {
    columnStyles[6 + i] = { cellWidth: dynamicColWidth, halign: 'center' };
  }

  doc.autoTable({
    startY: 60,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    columnStyles,
    didParseCell(data) {
      if (data.column.index >= 6) {
        data.cell.styles.halign = 'center';
        data.cell.styles.valign = 'middle';
      }
      if (data.section === 'body' && data.column.index >= 6) {
        const dateIndex = Math.floor((data.column.index - 6) / 2);
        const date = dateList[dateIndex];
        if (isHolidayColumn(date)) {
          data.cell.styles.fillColor = [254, 242, 242];
        }
      }
    },
    margin: { left: 30, right: 30, top: 60, bottom: 20 },
    pageBreak: 'avoid',
    rowPageBreak: 'avoid',
    tableWidth: 'auto'
  });

  const filename = `Laporan_Harian_Absensi_${fileDateStamp()}.pdf`;
  doc.save(filename);
  setProgress(100, 'File PDF berhasil diunduh.');
}

async function init() {
  applyTheme(getTheme());
  updateCacheInfo();

  $('themeToggle').addEventListener('click', () => {
    applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
  });

  $('loadBtn').addEventListener('click', async () => {
    try {
      await hydrateAndRender();
    } catch (error) {
      console.error(error);
      setProgress(0, 'Terjadi kesalahan saat memuat data.');
      alert(`Gagal memuat data: ${error.message}`);
    }
  });

  $('applyBtn').addEventListener('click', () => {
    if (!state.raw) return alert('Silakan muat data terlebih dahulu.');
    reRenderOnly();
  });

  $('exportPdfBtn').addEventListener('click', exportPdf);
  $('exportXlsxBtn').addEventListener('click', exportXlsx);

  $('clearCacheBtn').addEventListener('click', async () => {
    await clearLocalData();
    updateCacheInfo();
    state.source = '-';
    $('summarySource').textContent = '-';
    setProgress(0, 'Cache lokal berhasil dihapus.');
    alert('Data lokal aplikasi berhasil dihapus.');
  });

  [monthInput, startDateInput, endDateInput, titleSourceField].forEach(el => {
    el.addEventListener('change', () => {
      if (state.raw) reRenderOnly();
    });
  });

  try {
    const cached = await readDataset();
    if (cached) {
      state.raw = normalizeDataset(cached);
      state.holidayMap = buildHolidayMap(state.raw.holidays);
      buildFilterControls(state.raw.peserta);
      state.source = 'Cache lokal (IndexedDB)';
      state.rendered = buildRenderedData();
      renderTable(state.rendered);
      setProgress(100, 'Cache lokal dimuat.');
    }
  } catch (error) {
    console.warn('Gagal memuat cache awal', error);
  }
}

window.addEventListener('DOMContentLoaded', init);
