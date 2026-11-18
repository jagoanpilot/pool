#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/phantomrider-pool}"
SERVICE_USER="${SERVICE_USER:-phantomrider}"
if [[ $EUID -ne 0 ]]; then echo "Jalankan sebagai root: sudo ./scripts/uninstall.sh"; exit 1; fi
echo "Menghentikan service..."
systemctl stop phantomrider-pool.service 2>/dev/null || true
systemctl disable phantomrider-pool.service 2>/dev/null || true
rm -f /etc/systemd/system/phantomrider-pool.service
systemctl daemon-reload 2>/dev/null || true
rm -f /usr/local/bin/pool
echo "Data di $INSTALL_DIR tidak dihapus otomatis. Hapus manual jika diinginkan: rm -rf $INSTALL_DIR"
echo "User $SERVICE_USER tidak dihapus otomatis."
echo "Uninstall selesai."
