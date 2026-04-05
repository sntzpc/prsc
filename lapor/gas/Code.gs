/**
 * Google Apps Script backend untuk aplikasi laporan presensi.
 * Deploy sebagai Web App lalu salin URL-nya ke const GAS_URL di assets/app.js
 */
const DEFAULT_SPREADSHEET_ID = '18JkzFJHC6q1mfSzeyErH96dhBWMVQJDw4Fd6Oj8lgqQ';
const APP_TZ = 'Asia/Jakarta';

function doGet(e) {
  const spreadsheetId = (e?.parameter?.spreadsheetId || DEFAULT_SPREADSHEET_ID).trim();
  const include = (e?.parameter?.include || 'peserta,attendance,holidays,training_meta')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const result = {
    spreadsheetId,
    generatedAt: Utilities.formatDate(new Date(), APP_TZ, 'dd/MM/yyyy HH:mm:ss'),
    sheets: {}
  };

  include.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const range = sheet.getDataRange();
    const values = range.getDisplayValues();
    if (!values.length) {
      result.sheets[sheetName] = [];
      return;
    }

    const headers = values[0].map(v => String(v).trim());
    result.sheets[sheetName] = values
      .slice(1)
      .filter(row => row.some(cell => cell !== '' && cell !== null))
      .map(row => {
        const obj = {};
        headers.forEach((header, idx) => {
          const value = row[idx];
          obj[header] = normalizeCellValue_(value, sheetName, header);
        });
        return obj;
      });
  });

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function normalizeCellValue_(value, sheetName, header) {
  const sheet = String(sheetName).toLowerCase();
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (sheet === 'attendance') {
    const norm = normalizeDateString_(s, true, false);
    return norm || s;
  }
  if (sheet === 'holidays') {
    const norm = normalizeDateString_(s, false, false);
    return norm || s;
  }
  return s;
}

function normalizeDateString_(value, hasTimeDefault, preferMDYForDateOnly) {
  const s = String(value || '').trim();
  if (!s) return '';

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const yRaw = Number(m[3]);
    const y = yRaw < 100 ? (yRaw >= 70 ? 1900 + yRaw : 2000 + yRaw) : yRaw;
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    const hasTime = !!m[4] || hasTimeDefault;
    let d, mo;

    if (hasTime) {
      d = a; mo = b;
    } else if (a > 12 && b <= 12) {
      d = a; mo = b;
    } else if (b > 12 && a <= 12) {
      mo = a; d = b;
    } else if (preferMDYForDateOnly) {
      mo = a; d = b;
    } else {
      d = a; mo = b;
    }

    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      if (m[4]) {
        return Utilities.formatString('%02d/%02d/%04d %02d:%02d:%02d', d, mo, y, hh, mm, ss);
      }
      return Utilities.formatString('%02d/%02d/%04d', d, mo, y);
    }
  }

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const hh = Number(m[4] || 0), mm = Number(m[5] || 0), ss = Number(m[6] || 0);
    if (m[4]) return Utilities.formatString('%02d/%02d/%04d %02d:%02d:%02d', d, mo, y, hh, mm, ss);
    return Utilities.formatString('%02d/%02d/%04d', d, mo, y);
  }

  return '';
}
