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


## Revisi tambahan
- Normalisasi field frontend dibuat case-insensitive agar data tetap terbaca walau bentuk header dari GAS berubah.
- Jika `gate_direction` kosong, laporan tetap mencoba menampilkan pasangan data pertama dan kedua pada tanggal yang sama.
- Backend memakai `getDisplayValues()` agar tanggal/jam dari sheet tidak bergeser.


## Revisi libur nasional
- Parser tanggal kini mendukung format tahun 2 digit pada sheet holidays, misalnya `03/04/26` akan dibaca sebagai `2026-04-03`.
- Arsir merah tetap hanya untuk Minggu dan tanggal yang ada di sheet holidays.


## Revisi tambahan
- Jika memilih bulan, tanggal laporan selalu tampil 1 bulan penuh dari tanggal 1 sampai akhir bulan.
- Jika memilih tanggal awal/akhir, laporan mengikuti penuh rentang tanggal tersebut.
- PDF menggunakan ukuran kertas fleksibel agar seluruh kolom tampil dalam satu halaman.
