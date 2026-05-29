# Mapping Dependensi (Singkat) — Presensi Training Center (Modular)

Dokumen ini menjelaskan **file mana dipakai oleh fitur apa** dan **urutan dependensi** supaya maintenance lebih gampang.

> Patokan utama: lihat urutan `<script src="...">` di `index.html`. Itu adalah urutan load yang valid.

---

## 1) Urutan Load Script (Source of Truth)

Di `index.html` urutannya:

1. `face-api.js` (CDN)
2. `./libs/xlsx.full.min.js`
3. `./js/core/base.js`
4. `./js/core/api.js`
5. `./js/core/device.js`
6. `./js/core/busy.js`
7. `./js/core/face.js`
8. `./js/core/location_base.js`
9. `./js/core/geofence_core.js`
10. `./js/pages/geofence_admin.js`
11. `./js/core/mode.js`
12. `./js/core/status.js`
13. `./js/pages/camera.js`
14. `./js/pages/presensi.js`
15. `./js/pages/enroll.js`
16. `./js/core/admin_session.js`
17. `./js/pages/admin_reports.js`
18. `./js/pages/settings.js`
19. `./js/core/training_meta_public.js`
20. `./js/pages/training.js`
21. `./js/pages/materi.js`
22. `./js/pages/nametag.js`
23. `./js/app.js` (entrypoint)

**Rule:** Semua modul yang dipakai harus loaded sebelum `js/app.js`.

---

## 1.1 Diagram Dependensi Ringkas (ASCII)

```text
index.html
 ├─ (CDN) face-api.js
 ├─ libs/xlsx.full.min.js
 └─ js/
    ├─ core/base.js
    │   ├─ menyediakan: $, State, UI (result ✅/❌), helper DOM dasar
    │   └─ dipakai oleh: semua modul
    ├─ core/api.js ───────────────┐
    ├─ core/device.js             │
    ├─ core/busy.js               │
    ├─ core/face.js (butuh face-api.js)
    ├─ core/location_base.js      │
    ├─ core/geofence_core.js      │
    ├─ core/mode.js               │
    ├─ core/status.js             │
    └─ pages/                     │
       ├─ geofence_admin.js  <────┘  (Multi Lokasi + checkLocation)
       │    deps: base, api, busy, location_base, geofence_core
       ├─ camera.js                    (Modal Kamera)
       │    deps: base, busy, face
       ├─ presensi.js                  (Presensi Peserta)
       │    deps: base, api, busy, status, location_base, geofence_core, camera
       ├─ enroll.js                    (Enroll + Upload XLSX)
       │    deps: base, api, busy, xlsx
       ├─ core/admin_session.js        (Login Admin + session)
       │    deps: base, api
       ├─ admin_reports.js             (Rekap/Logs/Export)
       │    deps: base, api, busy
       ├─ settings.js                  (Settings Admin)
       │    deps: base, api
       ├─ core/training_meta_public.js (Cache meta training publik)
       │    deps: base, api
       ├─ training.js                  (CRUD Training)
       │    deps: base, api, training_meta_public
       ├─ materi.js                    (CRUD Materi)
       │    deps: base, api
       ├─ nametag.js                   (Card/NameTag)
       │    deps: base
       └─ app.js (entrypoint)
            ├─ main() → initMode(), initTraining(), initAdminModal(), initCameraModals(), dll
            └─ bergantung pada: semua core/pages di atas sudah loaded
```

Catatan cepat:
- Jika ada error `is not defined`, hampir selalu karena **urutan load** (dependensi belum diload sebelum pemakai).
- Fitur “Multi Lokasi” paling banyak menyentuh: `core/location_base.js` + `core/geofence_core.js` + `pages/geofence_admin.js`.

---

## 2) Core Modules (Dipakai lintas fitur)

### `js/core/base.js`
Dipakai oleh **semua** modul. Berisi:
- `$` selector helper
- `State` (global state)
- `UI` (helper output result/status)

### `js/core/api.js`
Dipakai oleh fitur yang akses server:
- presensi (kirim presensi)
- enroll (tarik/simpan peserta / upload xlsx)
- settings (load/save)
- training & materi CRUD
- geofence (download multi lokasi)
- dashboard/logs

### `js/core/device.js`
Dipakai oleh `js/app.js` untuk menampilkan/menyimpan `deviceId`.

### `js/core/busy.js`
Dipakai oleh tombol yang prosesnya lama:
- enroll: Test Connection, tarik server by NIK, upload/sync
- presensi: proses capture + submit
- admin pages: save/delete/export

### `js/core/face.js`
Dipakai oleh:
- `js/pages/camera.js` (stream, capture)
- `js/pages/presensi.js` (deteksi/match/liveness)

### `js/core/location_base.js`
Dipakai oleh:
- presensi: ambil lokasi & hitung jarak
- geofence admin: preview/check lokasi
- status pill (UI lokasi)

### `js/core/geofence_core.js`
Dipakai oleh:
- geofence admin page (CRUD + sync server)
- presensi (cek inside fence / nearest fence)

### `js/core/mode.js`
Dipakai oleh:
- app init (peserta/admin mode)
- training selector (jenis pelatihan, activity)
- UI enabling/disabling tombol presensi

### `js/core/status.js`
Dipakai oleh:
- presensi (validasi + output status)
- enroll/admin pages (output status ringkas)

### `js/core/admin_session.js`
Dipakai oleh:
- semua aksi admin yang perlu token (settings/training/materi/enroll/dashboard)
- `initAdminModal()` dan guard `isAdminSessionValid()`

### `js/core/training_meta_public.js`
Dipakai oleh:
- dashboard meta init
- enroll/presensi jika butuh mapping daftar training/activity dari server (read-only)

---

## 3) Pages/Features (Sesuai Pane/Modal)

### A) **Camera Modal**
- `js/pages/camera.js`
  - open/close modal kamera
  - start/stop stream
  - capture frame
- `js/core/face.js`
  - model load + detect + liveness

### B) **Presensi Peserta**
- `js/pages/presensi.js` (orchestrator flow)
  - cek lokasi → buka kamera → face detect/match → submit → UI result
- Dependensi:
  - `core/location_base.js` + `core/geofence_core.js` (geofence check)
  - `pages/camera.js` + `core/face.js` (kamera & face)
  - `core/api.js` (submit server)
  - `core/status.js` (output status)

### C) **Admin Modal — Enroll**
- `js/pages/enroll.js`
  - enroll manual
  - tarik server by NIK
  - upload XLSX (SheetJS)
- Dependensi:
  - `core/api.js`, `core/busy.js`, `core/status.js`, `libs/xlsx.full.min.js`
  - `core/admin_session.js` untuk guard

### D) **Admin Modal — Multi Lokasi**
- `js/pages/geofence_admin.js`
  - tampil/CRUD lokasi
  - download otomatis dari server
  - tombol “checkLocation”/preview jarak
- Dependensi:
  - `core/geofence_core.js`, `core/location_base.js`, `core/api.js`

### E) **Admin Modal — Dashboard/Rekap/Logs**
- `js/pages/admin_reports.js`
  - dashboard defaults
  - load logs/rekap
  - export/report actions (jika ada)
- Dependensi:
  - `core/api.js`, `core/busy.js`, `core/admin_session.js`

### F) **Admin Modal — Settings**
- `js/pages/settings.js`
  - load/save settings
- Dependensi:
  - `core/api.js`, `core/busy.js`, `core/admin_session.js`

### G) **Admin Modal — Training**
- `js/pages/training.js`
  - CRUD training meta
- Dependensi:
  - `core/api.js`, `core/busy.js`, `core/admin_session.js`

### H) **Admin Modal — Materi**
- `js/pages/materi.js`
  - CRUD materi
- Dependensi:
  - `core/api.js`, `core/busy.js`, `core/admin_session.js`

### I) **Admin Modal — NameTag/Card**
- `js/pages/nametag.js`
  - generator card
- Dependensi:
  - `core/base.js` (+ optional busy/status)

---

## 4) Entry Point

### `js/app.js`
Mengikat semuanya:
- deviceId init
- initMode/initTraining
- initAdminModal
- initCameraModals

Kalau ada fitur “tidak muncul”, cek:
1) file terkait sudah di-load di `index.html`?
2) `init...()` dipanggil dari `main()`?
3) selector element id/class sesuai dengan `index.html`?

---

## 5) File Cadangan / Opsional (Bisa diabaikan bila tidak dipakai)

- `app.legacy.js` : backup monolith lama (tidak di-load).
- `js/app_init.js` : helper opsional (bisa belum dipakai).
- `js/core/geofence.js` : kompatibilitas lama (prefer `geofence_core.js`).
- `js/core/training_meta.js` : kompatibilitas lama (prefer `training_meta_public.js` + `pages/training.js`).
- `js/pages/admin_session.js` : helper UI session opsional (bila tidak dipakai bisa dibiarkan).

---

## 6) Tips Maintenance Cepat

- Cari fitur → buka file `js/pages/<fitur>.js`.
- Kalau error “State/UI/$ undefined” → pastikan `core/base.js` loaded sebelum file tersebut.
- Kalau error terkait backend → fokus di `core/api.js` (URL, action, payload, CORS).
- Kalau geofence tidak akurat → fokus di `core/location_base.js` + `core/geofence_core.js`.