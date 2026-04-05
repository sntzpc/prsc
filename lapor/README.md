# Aplikasi Laporan Harian Absensi

Aplikasi ini dibuat dari struktur database spreadsheet **18JkzFJHC6q1mfSzeyErH96dhBWMVQJDw4Fd6Oj8lgqQ** dan contoh format PDF yang Anda lampirkan.

## Isi ZIP
- `index.html` - aplikasi utama
- `assets/app.js` - logika aplikasi (Tailwind + IndexedDB + ekspor XLSX/PDF)
- `assets/styles.css` - styling tambahan
- `gas/Code.gs` - backend Google Apps Script
- `data/sample-db.json` - data sample hasil ekstraksi dari file Excel terlampir untuk fallback/demo offline

## Fitur
- Filter bulan, rentang tanggal, dan seluruh header utama sheet `peserta`
- Ambil data presensi dari sheet `attendance`
- Hari weekend dan `holidays` diberi arsir merah
- Cache lokal menggunakan **IndexedDB**
- Tombol **Hapus Data Lokal**
- Ekspor **PDF** dan **XLSX**
- **Light / Dark mode** (default light)
- **Progress bar** selama proses muat, olah, dan ekspor
- Responsif untuk mobile

## Cara pakai
1. Buka file `gas/Code.gs` di Google Apps Script baru.
2. Deploy sebagai **Web App**.
3. Salin URL Web App hasil deploy.
4. Buka `assets/app.js`, lalu ganti nilai:
   ```js
   const GAS_URL = 'https://script.google.com/macros/s/PASTE_DEPLOYED_WEBAPP_URL_HERE/exec';
   ```
5. Jalankan `index.html` melalui web server sederhana.

## Web server lokal
Contoh termudah:
```bash
python -m http.server 8000
```
Lalu buka folder ZIP hasil extract, misalnya:
`http://localhost:8000/`

## Catatan logika absensi
- **Masuk** = jam paling awal dengan `gate_direction = IN`, fallback ke timestamp pertama hari itu.
- **Keluar** = jam paling akhir dengan `gate_direction = OUT`, fallback ke timestamp terakhir hari itu.
- Jika filter kosong, aplikasi menampilkan semua data yang tersedia.

## Nama file unduhan
- PDF: `Laporan_Harian_Absensi_YYYYMMDD.pdf`
- XLSX: `Laporan_Harian_Absensi_YYYYMMDD.xlsx`
