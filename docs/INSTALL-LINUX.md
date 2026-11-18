# Panduan Instalasi Linux — PhantomRider Pool

## Prasyarat
- Ubuntu 22.04/24.04, Debian 12, atau distro systemd setara.
- Akses root/sudo.
- Node.js >= 18, npm, build-essential/gcc/g++, cmake, git (installer mencoba memasang via apt/dnf/yum).
- Node PhantomRider tersinkron dengan RPC aktif.

## Langkah instalasi
```bash
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```
Default direktori instalasi: `/opt/phantomrider-pool` (ubah dengan `INSTALL_DIR=/path sudo -E ./scripts/install.sh`).

Installer melakukan:
1. Deteksi distro & pemasangan dependency.
2. Pemeriksaan Node.js/npm.
3. Build helper algoritma PHR-256-YP (`cmake` + `phr_yp` asli).
4. Pembuatan user `phantomrider`, folder data, konfigurasi.
5. Instalasi npm dependencies.
6. Pemasangan systemd unit `phantomrider-pool.service`, enable & start.
7. Symlink CLI `pool` ke `/usr/local/bin/pool`.
8. Pemeriksaan status awal.

## Konfigurasi
```bash
sudo nano /opt/phantomrider-pool/config/pool.yaml
sudo nano /opt/phantomrider-pool/.env   # RPC_PASSWORD
```
Wajib ditinjau:
- `network.rpc_url/user/password`
- **`mining.pool_script_hex`** (scriptPubKey payout pool, sesuai chain PhantomRider)
- `stratum.port`, `dashboard.port`, parameter difficulty/reward

Kemudian:
```bash
pool restart
pool status
pool logs -f
```

## Manajemen service
```bash
sudo systemctl start phantomrider-pool
sudo systemctl stop phantomrider-pool
sudo systemctl restart phantomrider-pool
sudo systemctl status phantomrider-pool
journalctl -u phantomrider-pool -f
```

## Update & uninstall
```bash
sudo ./scripts/update.sh
sudo ./scripts/uninstall.sh   # data tidak dihapus otomatis
```

## Catatan
- Pastikan helper terbangun: `algorithm/phantomrider/build/phr_hash`.
- Jika `npm install` gagal membangun `better-sqlite3`, pasang toolchain build lalu ulangi; pool memiliki fallback JSON store untuk operasional dasar namun SQLite direkomendasikan.
- Validasi kompatibilitas RPC/template/submitblock dengan node PhantomRider nyata sebelum produksi.
