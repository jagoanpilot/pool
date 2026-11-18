# PhantomRider PHR-256-YP Adapter

Adapter algoritma PoW untuk PhantomRider Mining Pool, berdasarkan source resmi `PhantomRider_v0_1`.

## Algoritma
- **PHR-256-YP** (YesPower-style, stateless, consensus PoW yang digunakan untuk hash header blok 80-byte).
- Parameter default: dataset 1 MiB, rounds 32, personalization `PHR`.
- Implementasi referensi: `phr_yp.cpp` / `phr_yp.h` (self-contained, tanpa OpenSSL).
- Output: digest 32-byte big-endian. Perbandingan target: `hash <= target` (big-endian integer).

## File
- `phr_yp.h`, `phr_yp.cpp`: implementasi hashing asli (tidak diubah).
- `phr_hash.cpp`: helper CLI untuk pool (mode server stdin/stdout dan one-shot).
- `phr_yp_selftest.cpp`: test vector resmi.
- `phr_yp_ref.py`: referensi Python (lambat, untuk verifikasi vektor).
- `CMakeLists.txt`: build helper.

## Build
```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
./build/phr_yp_selftest
```

Windows (MSVC):
```powershell
cmake -S . -B build
cmake --build build --config Release
.\build\Release\phr_yp_selftest.exe
```

## Protokol helper pool
- Input: `H <id> <header_hex>`
- Output: `H <id> <hash_hex>` atau `H <id> err`
- `Q` untuk keluar.

Header adalah 80-byte serialized block header (format Bitcoin: nVersion LE, hashPrevBlock 32, hashMerkleRoot 32, nTime LE, nBits LE, nNonce LE). Hash yang dikembalikan adalah digest PHR-256-YP big-endian; node PhantomRider menyimpan PoW hash sebagai uint256 little-endian-internal (byte-reversed dari digest) untuk perbandingan target internal, tetapi validasi share/pool dilakukan terhadap digest big-endian vs target big-endian.
