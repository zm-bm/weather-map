#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"


ETL_OUT="$ROOT/etl/out"
BACKEND_MB="$ROOT/backend/data/mbtiles"
FRONTEND_MANIFESTS="$ROOT/frontend/public/manifests"

echo "Sync tiles -> backend"
mkdir -p "$BACKEND_MB"
rsync -a --delete "$ETL_OUT/tiles/" "$BACKEND_MB/"

echo "Sync manifests -> frontend"
mkdir -p "$FRONTEND_MANIFESTS"
rsync -a --delete "$ETL_OUT/manifests/" "$FRONTEND_MANIFESTS/"

echo "Done."
