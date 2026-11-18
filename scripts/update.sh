#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/phantomrider-pool}"
cd "$INSTALL_DIR"
echo "Update PhantomRider Pool di $INSTALL_DIR"
if command -v git >/dev/null 2>&1 && [[ -d .git ]]; then git pull --ff-only || echo "git pull gagal/lewati"; fi
npm install --omit=dev || true
if command -v cmake >/dev/null 2>&1; then (cd algorithm/phantomrider && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j) || echo "Build algo gagal"; fi
if command -v systemctl >/dev/null 2>&1; then sudo systemctl restart phantomrider-pool || systemctl restart phantomrider-pool || true; else echo "Restart manual: pool restart"; fi
echo "Selesai. Cek: pool status"
