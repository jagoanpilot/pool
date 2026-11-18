# Troubleshooting — PhantomRider Pool

## 1. Helper algoritma tidak siap (`algorithm helper: NOT READY`)
**Gejala:** `pool status` menampilkan helper belum siap, share ditolak dengan "Hash error"/"phr_hash helper not ready".
**Penyebab:** `phr_hash` belum dibangun atau path salah.
**Solusi:**
- Pastikan CMake dan compiler terpasang.
- Build: `cd algorithm/phantomrider && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j` (Linux) atau `cmake -S . -B build; cmake --build build --config Release` (Windows).
- Set `algorithm.helper_path` di `config/pool.yaml` jika lokasi binary non-standar.
- Uji: `./build/phr_yp_selftest` / `phr_yp_selftest.exe`.

## 2. RPC gagal / template tidak tersedia
**Gejala:** log `Template refresh failed`, `pool status` RPC ERR.
**Penyebab:** node PhantomRider mati, belum sinkron, kredensial salah, URL/port salah.
**Solusi:**
- Cek node berjalan dan RPC aktif; uji `curl --user user:pass --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblocktemplate","params":[]}' -H 'content-type:text/plain;' http://127.0.0.1:PORT/`.
- Periksa `network.rpc_url/rpc_user/rpc_password` dan `.env` (`RPC_PASSWORD`).
- Pastikan `systemd`/service tidak berjalan sebagai user tanpa akses jaringan/konfigurasi.

## 3. Error `mining.pool_script_hex ... wajib diisi`
**Penyebab:** Pool memerlukan scriptPubKey payout untuk coinbase, namun konversi alamat→script bergantung format alamat chain PhantomRider.
**Solusi:** Tentukan `scriptPubKey` hex yang valid untuk alamat payout pool (mis. dari node/wallet/tools chain) dan isi `mining.pool_script_hex` (atau `rewards.pool_script_hex`) di `config/pool.yaml`. **Validasi dengan node nyata** agar blok/coinbase diterima.

## 4. `submitblock` ditolak node
**Gejala:** log `Block rejected by node` atau error submit.
**Penyebab:** Konstruksi blok/coinbase belum sesuai konsensus PhantomRider (CbTx/DIP0003 payload, smartnode/superblock/founder outputs, urutan/amount output, version/extra payload, dll). Node yang dianalisis bersifat Dash-derived.
**Solusi:**
- Bandingkan blok yang dihasilkan pool dengan blok dari `getblocktemplate`/`generatetoaddress` (regtest/testnet) pada node PhantomRider.
- Sesuaikan builder di `lib/block.js` agar coinbase dan struktur blok identik dengan yang diharapkan konsensus.
- Uji di jaringan test/regtest sebelum mainnet/produksi. Jangan mengklaim block submission berhasil tanpa verifikasi.

## 5. Miner tidak bisa connect / rejected shares
- Pastikan port Stratum terbuka dan service mendengarkan (`pool status`, `ss -ltnp`/`netstat`).
- Verifikasi miner **mendukung PHR-256-YP** (algoritma kustom). Miner algoritma lain tidak kompatibel.
- Format login: `wallet_address.worker_name`, password `x`.
- `Low difficulty share`: vardiff/min difficulty terlalu tinggi untuk hashrate miner; turunkan `mining.min_difficulty/default_difficulty`.
- `Stale/Job not found`: latensi tinggi atau job berubah; normal dalam jumlah kecil.

## 6. npm install gagal (`better-sqlite3`)
**Penyebab:** butuh toolchain native build.
**Solusi:** pasang build tools (Linux: `build-essential python3 make g++`; Windows: VS Build Tools). Ulangi `npm install --omit=dev`. Pool mencoba fallback JSON store jika SQLite driver gagal dimuat, namun untuk produksi gunakan SQLite.

## 7. Dashboard tidak bisa diakses
- Cek `dashboard.enabled`, host/port, dan firewall.
- `pool status` / `pool logs` untuk error binding port.
- API health: `http://127.0.0.1:<port>/api/status`.

## 8. Restart loop / service gagal terus
- Lihat log: `journalctl -u phantomrider-pool -n 200` (Linux) atau `data/logs/*` (Windows).
- Perbaiki penyebab (config, helper, RPC). `RestartSec`/limit dibatasi di unit service, namun konfigurasi rusak akan tetap gagal start hingga diperbaiki.

## 9. Validasi algoritma
- Jalankan `npm test` dan/atau `phr_yp_selftest` native. Vektor referensi resmi ada di `algorithm/phantomrider`.
- Bandingkan hash header 80-byte yang sama dengan implementasi node (`ComputeHash/GetPOWHash`) untuk memastikan kesesuaian byte order/serialisasi.
