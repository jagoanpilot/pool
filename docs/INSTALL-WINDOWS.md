# Panduan Instalasi Windows — PhantomRider Pool

## Prasyarat
- Windows 10/11 atau Windows Server.
- PowerShell (Administrator).
- Node.js >= 18 dan npm: https://nodejs.org/
- (Direkomendasikan) Visual Studio Build Tools (C++), CMake, dan Git untuk membangun helper algoritma `phr_hash` dan dependency native.
- Node PhantomRider tersinkron dengan RPC aktif (localhost/disarankan tidak diekspos publik).

## Langkah instalasi
1. Buka PowerShell sebagai **Administrator** di folder proyek `phantomrider-pool`.
2. Jalankan:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\install.ps1
   ```
3. Installer akan:
   - Memeriksa versi Windows, Node.js/npm, dan CMake.
   - Menyalin file ke `C:\phantomrider-pool` (default, bisa ubah via `$env:INSTALL_DIR`).
   - Menjalankan `npm install --omit=dev`.
   - Membangun helper algoritma PHR-256-YP (jika CMake tersedia).
   - Membuat folder `data/`, menyalin `.env.example` → `.env` bila belum ada.
   - Menambahkan `bin` ke PATH dan mencoba memasang/menjalankan Windows Service (WinSW) jika `service\winsw.exe` tersedia.
   - Menjalankan pemeriksaan status.

## Konfigurasi
Edit `C:\phantomrider-pool\config\pool.yaml` dan `C:\phantomrider-pool\.env`:
- `network.rpc_url`, `network.rpc_user`, `network.rpc_password` (`RPC_PASSWORD` di `.env`).
- `stratum.port` (default 3333), `dashboard.port` (default 8080).
- **`mining.pool_script_hex`**: scriptPubKey hex untuk payout coinbase pool (wajib; sesuai format chain PhantomRider).
- Sesuaikan difficulty, fee, dan parameter reward.

Lalu:
```powershell
pool restart
pool status
pool logs
```

## Windows Service (WinSW)
- File contoh: `service\phantomrider-pool.xml`.
- Unduh WinSW, simpan sebagai `service\winsw.exe`, sesuaikan path di XML bila perlu, lalu:
  ```powershell
  cd C:\phantomrider-pool\service
  .\winsw.exe install
  .\winsw.exe start
  ```
- Jika service tidak digunakan, `pool start` menjalankan pool di background.

## Pemeriksaan
- `pool status` menampilkan proses, RPC, helper algoritma, stratum, dan statistik.
- Dashboard: `http://SERVER_IP:<dashboard.port>`.
- Stratum: `stratum+tcp://SERVER_IP:<stratum.port>`.

## Catatan
- Jangan membuka port RPC node ke internet.
- Pastikan helper `phr_hash` berhasil dibangun (`algorithm\phantomrider\build\Release\phr_hash.exe`); tanpa itu verifikasi share tidak dapat berjalan.
- Validasi `getblocktemplate` dan `submitblock` terhadap node PhantomRider nyata sebelum produksi (aturan coinbase/consensus chain-specific).
