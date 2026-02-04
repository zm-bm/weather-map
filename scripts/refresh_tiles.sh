#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"


ETL_OUT="$ROOT/etl/out"
TILES_DIR="$ROOT/tile-data/tiles"
FRONTEND_MANIFESTS="$ROOT/frontend/public/manifests"

echo "Sync tiles -> tile server"
mkdir -p "$TILES_DIR"
rsync -a --delete "$ETL_OUT/tiles/" "$TILES_DIR/"

echo "Sync manifests -> frontend"
mkdir -p "$FRONTEND_MANIFESTS"
rsync -a --delete "$ETL_OUT/manifests/" "$FRONTEND_MANIFESTS/"

echo "Done."
