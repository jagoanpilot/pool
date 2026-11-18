#!/usr/bin/env bash
set -euo pipefail

# PhantomRider Pool installer (Linux)
# Jalankan: chmod +x scripts/install.sh && sudo ./scripts/install.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/phantomrider-pool}"
SERVICE_USER="${SERVICE_USER:-phantomrider}"

echo "== PhantomRider Pool Installer (Linux) =="
if [[ $EUID -ne 0 ]]; then
  echo "Harap jalankan sebagai root: sudo ./scripts/install.sh"; exit 1
fi

# 1) Detect distro
if [[ -f /etc/os-release ]]; then . /etc/os-release; echo "Distro: ${ID:-unknown} ${VERSION_ID:-}"; else echo "Tidak dapat mendeteksi distro (/etc/os-release tidak ada)"; fi

# 2) Install dependencies (best-effort)
install_deps() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y curl ca-certificates build-essential cmake git python3 || true
    # Node.js 18+ (NodeSource if needed)
    if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
      echo "Menginstal Node.js LTS..."
      curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - || true
      apt-get install -y nodejs || true
    fi
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl ca-certificates gcc gcc-c++ make cmake git python3 nodejs npm || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl ca-certificates gcc gcc-c++ make cmake git python3 nodejs npm || true
  else
    echo "Peringatan: package manager tidak dikenali. Pastikan node>=18, npm, build-essential/gcc, cmake terpasang."
  fi
}
echo "[1/12] Memeriksa/memasang dependency..."
install_deps

echo "[2/12] Memeriksa runtime..."
command -v node >/dev/null 2>&1 || { echo "ERROR: node tidak ditemukan."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm tidak ditemukan."; exit 1; }
NODE_MAJOR="$(node -v | sed 's/v//' | cut -d. -f1)"
if [[ "$NODE_MAJOR" -lt 18 ]]; then echo "ERROR: Node.js >= 18 diperlukan (ditemukan $(node -v))."; exit 1; fi
echo "Node: $(node -v), npm: $(npm -v)"

# 3) Copy/install files
echo "[3/12] Menyalin file ke ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
# copy project contents
rsync -a --exclude 'node_modules' --exclude 'algorithm/phantomrider/build' --exclude 'data/database/*.db*' "$ROOT_DIR/" "$INSTALL_DIR/" 2>/dev/null || cp -a "$ROOT_DIR/." "$INSTALL_DIR/"

# 4) Create user
echo "[4/12] Membuat user service ${SERVICE_USER}..."
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" || useradd --system --home "$INSTALL_DIR" --shell /bin/false "$SERVICE_USER" || true
fi

# 5) Install npm deps and build algorithm
echo "[5/12] npm install..."
cd "$INSTALL_DIR"
npm install --omit=dev || { echo "Peringatan: npm install gagal (mungkin butuh toolchain untuk better-sqlite3). Coba install build tools lalu ulangi."; }

echo "[6/12] Build algorithm helper (PHR-256-YP)..."
if command -v cmake >/dev/null 2>&1; then
  (cd algorithm/phantomrider && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j) || echo "Peringatan: build helper gagal. Pastikan compiler/cmake tersedia, lalu jalankan: npm run build:algo"
else
  echo "Peringatan: cmake tidak ditemukan, helper tidak dibangun. Share verification memerlukan phr_hash."
fi

# 7) Data dirs & config
echo "[7/12] Menyiapkan direktori data dan konfigurasi..."
mkdir -p "$INSTALL_DIR/data/database" "$INSTALL_DIR/data/logs"
if [[ ! -f "$INSTALL_DIR/config/pool.yaml" ]]; then echo "ERROR: config/pool.yaml tidak ditemukan."; exit 1; fi
# generate random rpc password placeholder hint if not set
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env" || true
  echo "Edit $INSTALL_DIR/.env dan set RPC_PASSWORD sebelum menjalankan produksi." 
fi

# 8) Permissions
echo "[8/12] Mengatur permission..."
chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR/data" || true
chmod 750 "$INSTALL_DIR/config" || true
chmod 640 "$INSTALL_DIR/config/pool.yaml" || true
chmod +x "$INSTALL_DIR/bin/pool" "$INSTALL_DIR/bin/pool.js" || true

# 9) systemd service
echo "[9/12] Memasang systemd service..."
if command -v systemctl >/dev/null 2>&1; then
  cp "$INSTALL_DIR/service/phantomrider-pool.service" /etc/systemd/system/phantomrider-pool.service
  # adjust WorkingDirectory if custom INSTALL_DIR
  sed -i "s|/opt/phantomrider-pool|$INSTALL_DIR|g" /etc/systemd/system/phantomrider-pool.service || true
  systemctl daemon-reload
  systemctl enable phantomrider-pool.service || true
else
  echo "Peringatan: systemctl tidak tersedia; lewati pemasangan service."
fi

# 10) CLI symlink
echo "[10/12] Memasang command 'pool'..."
ln -sf "$INSTALL_DIR/bin/pool" /usr/local/bin/pool || true

# 11) Start service
echo "[11/12] Menjalankan service..."
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart phantomrider-pool.service || systemctl start phantomrider-pool.service || echo "Peringatan: gagal start service. Cek: journalctl -u phantomrider-pool -n 100"
  sleep 2
  systemctl --no-pager --full status phantomrider-pool.service || true
else
  echo "systemd tidak tersedia; jalankan manual: pool start"
fi

# 12) Health checks
echo "[12/12] Pemeriksaan..."
echo "- Port Stratum: $(grep -E '^\s*port:' "$INSTALL_DIR/config/pool.yaml" | head -n1 || echo 'lihat config')"
echo "- Dashboard: $(grep -n 'dashboard:' -n "$INSTALL_DIR/config/pool.yaml" >/dev/null 2>&1 && echo 'aktif (cek port di config)' || echo 'cek config')"
echo "- RPC: pastikan network.rpc_url/user/password benar dan node PhantomRider berjalan."
echo ""
echo "Selesai. Langkah berikutnya:"
echo "  1) Edit konfigurasi: sudo nano $INSTALL_DIR/config/pool.yaml (dan .env untuk RPC_PASSWORD)"
echo "  2) Isi mining.pool_script_hex (scriptPubKey payout pool) sesuai chain PhantomRider"
echo "  3) pool restart && pool status"
echo "  4) Buka dashboard di port yang dikonfigurasi"
echo ""
echo "CATATAN PENTING: Verifikasi koneksi RPC, template blok, dan submitblock terhadap node PhantomRider nyata sebelum produksi."
