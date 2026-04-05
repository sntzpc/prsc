/**
 * Google Apps Script backend untuk aplikasi laporan presensi.
 * Deploy sebagai Web App lalu salin URL-nya ke const GAS_URL di assets/app.js
 */
const DEFAULT_SPREADSHEET_ID = '18JkzFJHC6q1mfSzeyErH96dhBWMVQJDw4Fd6Oj8lgqQ';

function doGet(e) {
  const spreadsheetId = (e?.parameter?.spreadsheetId || DEFAULT_SPREADSHEET_ID).trim();
  const include = (e?.parameter?.include || 'peserta,attendance,holidays,training_meta')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const result = {
    spreadsheetId,
    generatedAt: new Date().toISOString(),
    sheets: {}
  };

  include.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const values = sheet.getDataRange().getValues();
    if (!values.length) {
      result.sheets[sheetName] = [];
      return;
    }
    const headers = values[0].map(v => String(v).trim());
    result.sheets[sheetName] = values.slice(1).filter(row => row.some(cell => cell !== '' && cell !== null)).map(row => {
      const obj = {};
      headers.forEach((header, idx) => {
        let value = row[idx];
        if (value instanceof Date) value = value.toISOString();
        obj[header] = value;
      });
      return obj;
    });
  });

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
