
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

function toISODate(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const s = value.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(s);
    if (!Number.isNaN(d.valueOf())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return '';
  }
  const d = new Date(value);
  return Number.isNaN(d.valueOf()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(value) {
  if (!value) return '';
  const s = String(value).trim();
  let m = s.match(/(?:T|\s)(\d{2}):(\d{2})(?::\d{2})?/);
  if (m) return `${m[1]}.${m[2]}`;
  m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2]}`;
  m = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (m) return `${m[1].padStart(2, '0')}.${m[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.valueOf())) return '';
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDateLong(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtMonthYear(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase();
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

function normalizeDataset(raw) {
  const sheets = raw.sheets || raw;
  const peserta = (sheets.peserta || []).map(item => {
    const obj = {};
    PARTICIPANT_FIELDS.forEach(field => obj[field] = item[field] ?? '');
    obj.nik = String(obj.nik ?? '');
    return obj;
  });
  const attendance = (sheets.attendance || []).map(item => ({
    timestamp: item.timestamp,
    nik: String(item.nik ?? ''),
    nama: item.nama ?? '',
    mode: item.mode ?? '',
    training_type: item.training_type ?? '',
    activity: item.activity ?? '',
    gate_reason: item.gate_reason ?? '',
    gate_direction: item.gate_direction ?? '',
    status: item.status ?? ''
  })).filter(item => item.timestamp && item.nik);

  const holidays = (sheets.holidays || []).map(item => ({
    tanggal: toISODate(item.tanggal),
    keterangan: item.keterangan || 'Hari libur'
  })).filter(item => item.tanggal);

  return { peserta, attendance, holidays };
}

function buildHolidayMap(holidays) {
  const map = new Map();
  holidays.forEach(item => map.set(item.tanggal, item.keterangan));
  return map;
}

function getDateRangeFromFilters(allDates) {
  const sorted = [...allDates].sort();
  if (!sorted.length) return [];
  if (monthInput.value) {
    const prefix = monthInput.value;
    return sorted.filter(date => date.startsWith(prefix));
  }
  const start = startDateInput.value || sorted[0];
  const end = endDateInput.value || sorted[sorted.length - 1];
  return sorted.filter(date => date >= start && date <= end);
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
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const ins = records.filter(r => String(r.gate_direction).toUpperCase() === 'IN');
      const outs = records.filter(r => String(r.gate_direction).toUpperCase() === 'OUT');
      const masuk = ins[0]?.timestamp || records[0]?.timestamp || '';
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
  const date = new Date(`${isoDate}T00:00:00`);
  const isSunday = date.getDay() === 0;
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
    const d = new Date(`${date}T00:00:00`);
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
    await saveDataset(raw);
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
  const d = new Date(`${date}T00:00:00`);
  if (d.getDay() === 0) return 'Minggu';
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
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });

  doc.setFontSize(16);
  doc.text(title, 40, 40);
  doc.setFontSize(10);
  doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, 40, 58);

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
          content: `${new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit' })}\n${new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short' })}`,
          colSpan: 2,
          styles: {
            halign: 'center',
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

  doc.autoTable({
    startY: 70,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 3, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 26, halign: 'center' },
      1: { cellWidth: 60 },
      2: { cellWidth: 120 },
      3: { cellWidth: 80 },
      4: { cellWidth: 50 },
      5: { cellWidth: 55 }
    },
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
    margin: { left: 30, right: 30, top: 70 }
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
