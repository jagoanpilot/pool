# PhantomRider Mining Pool

Mining pool untuk algoritma kustom **PHR-256-YP (PhantomRider)**, dibangun dengan prioritas: **kompatibilitas algoritma asli + instalasi sederhana + konfigurasi sederhana**.

> **Penting (analisis & status):**
> - Algoritma PoW diambil dari source asli `PhantomRider_v0_1` (`phr_yp.cpp/.h`, self-contained, tanpa OpenSSL) dan **tidak diubah**. Pool memanggil helper `phr_hash` yang dibangun dari source tersebut untuk verifikasi share/header.
> - PHR-256-YP: hash header blok 80-byte (format Bitcoin: `nVersion` LE, `hashPrevBlock`, `hashMerkleRoot`, `nTime` LE, `nBits` LE, `nNonce` LE), dataset 1 MiB, 32 round, personalisasi `PHR`, digest 32-byte big-endian.
> - Node yang dianalisis (`phantoomrider`, Dash-derived) menggunakan RPC `getblocktemplate`/`submitblock` dan memiliki aturan coinbase/outputs khusus (smartnode/superblock/founder, CbTx/payload DIP0003, dll). **Integrasi RPC & konstruksi blok submitblock harus divalidasi terhadap node PhantomRider yang berjalan**. Implementasi saat ini bersifat best-effort berdasarkan template GBT dan dapat memerlukan penyesuaian konsensus/format alamat→script.
> - Pengujian end-to-end mining/block submission terhadap node nyata **belum dapat diklaim berhasil** dari lingkungan pengembangan ini; gunakan `mock RPC`/node nyata untuk verifikasi sebelum produksi.

## Fitur yang diimplementasikan (core)
- Algoritma: adapter PHR-256-YP + helper native `phr_hash` + test vector.
- Stratum server (TCP, TLS opsional di config) untuk distribusi job dan submit share.
- Verifikasi share PoW PHR-256-YP, deteksi duplicate/stale/low-difficulty.
- Variable difficulty (vardiff).
- Integrasi RPC node (`getbestblockhash`, `getblocktemplate`, `submitblock`) dengan penanganan error.
- Database (SQLite via `better-sqlite3`, fallback JSON bila driver tidak tersedia).
- Akuntansi dasar: miner/worker, share accepted/rejected/stale, riwayat blok kandidat/hasil submit.
- Dashboard web + API status (Overview, Miners, Workers, Blocks, Payments, Statistics, Configuration, System Logs).
- CLI: `pool start|stop|restart|status|logs|config|update|uninstall`.
- Service: `systemd` unit (Linux) dan contoh WinSW (Windows).
- Installer: `scripts/install.sh`, `scripts/install.ps1`.
- Konfigurasi tunggal: `config/pool.yaml`.

## Fitur yang memerlukan validasi/penyesuaian node nyata
- Konversi alamat payout pool ke `scriptPubKey` (`mining.pool_script_hex`) sesuai format alamat PhantomRider.
- Konstruksi coinbase/blok penuh yang memenuhi semua aturan konsensus PhantomRider (CbTx, smartnode/superblock/founder, payload, fees/special tx, dll).
- Payout otomatis on-chain (saat ini skema/ledger disiapkan, pengiriman payout perlu dikaitkan ke wallet/RPC chain dan aturan konfirmasi spesifik).
- Format `getblocktemplate`/field tambahan jika berbeda dari asumsi.

## Struktur proyek
```
phantomrider-pool/
├── bin/                  # pool CLI
├── algorithm/phantomrider/  # phr_yp asli + adapter + helper (build)
├── config/pool.yaml      # konfigurasi utama
├── data/database/        # SQLite/JSON data
├── data/logs/
├── scripts/              # install/update/uninstall (.sh/.ps1)
├── service/              # systemd & WinSW
├── dashboard/            # UI web
├── lib/                  # server, stratum, rpc, db, block, dashboard
├── test/
├── README.md
├── .env.example
└── package.json
```

## Prasyarat
- Node.js >= 18 dan npm
- Compiler C/C++ + CMake (untuk membangun `phr_hash` helper algoritma) — **wajib untuk verifikasi share**
- Node PhantomRider tersinkron dengan RPC aktif
- Linux: systemd (opsional tapi direkomendasikan). Windows: hak Administrator untuk instalasi service.

## Instalasi cepat

### Windows (PowerShell Administrator)
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install.ps1
```

### Linux (Ubuntu/Debian)
```bash
chmod +x scripts/install.sh
sudo ./scripts/install.sh
```

## Konfigurasi
Edit satu file: `config/pool.yaml` (dan `.env` untuk `RPC_PASSWORD`).

Hal penting:
- `network.rpc_url`, `network.rpc_user`, `network.rpc_password` (`${RPC_PASSWORD}` dari env).
- `stratum.port`, `dashboard.port`.
- **`mining.pool_script_hex`**: scriptPubKey hex untuk payout coinbase pool (wajib diisi; konversi alamat→script bergantung chain PhantomRider).
- `rewards.scheme`, `pool_fee`, `minimum_payout`: sesuaikan unit/aturan chain.
- `mining.min_difficulty/max_difficulty/default_difficulty`: sesuaikan hashrate/miner.

Setelah edit:
```bash
pool restart
pool status
```

## Koneksi miner
```
stratum+tcp://SERVER_IP:3333
```
Worker: `wallet_address.worker_name`  (password: `x`)

Contoh command miner **hanya dapat diberikan jika ada software miner yang sudah mendukung PHR-256-YP**. Jangan gunakan contoh miner untuk algoritma lain (SHA256/Scrypt/RandomX/dll) karena tidak kompatibel.

## Manajemen
```bash
pool start
pool stop
pool restart
pool status
pool logs [-f]
pool config
pool update
pool uninstall
```

## Build & test algoritma
```bash
npm run build:algo
npm test
# atau langsung:
cd algorithm/phantomrider && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j && ./build/phr_yp_selftest
```

Test vector PHR-256-YP (dari source asli): 64B/1r, 1MiB/32r, 80B/1MiB/32r (lihat `algorithm/phantomrider/README.md`).

## Keamanan
- RPC node **tidak** dibuka ke internet; gunakan kredensial kuat via env (`RPC_PASSWORD`).
- Secret tidak disimpan di repo; dashboard tidak mengekspos password RPC.
- Batasi koneksi miner, validasi input, deteksi duplicate/stale share.
- Jalankan service dengan user terbatas (`phantomrider` di Linux).
- Audit log di `data/logs/pool.log`.

## Catatan kompatibilitas algoritma
- Implementasi hashing: `algorithm/phantomrider/phr_yp.cpp` & `.h` adalah salinan source asli PhantomRider_v0_1 (PHR-256-YP) tanpa modifikasi algoritma.
- Pool memverifikasi share dengan menghitung ulang PHR-256-YP atas header 80-byte hasil rekonstruksi stratum (sesuai cara node menghitung `GetPOWHash`).
- Perbedaan representasi: digest PHR-256-YP big-endian; node menyimpan uint256 PoW hash dalam representasi internal little-endian (byte-reversed) — perbandingan target tetap ekuivalen (`hash <= target`).

## Lisensi
Kode pool ini disediakan apa adanya. Komponen algoritma mengikuti lisensi/sumber asli PhantomRider_v0_1 (lihat `LICENSE`/README di source asal).
