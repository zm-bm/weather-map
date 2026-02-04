#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"


ETL_OUT="$ROOT/etl/out"
BACKEND_MB="$ROOT/tile-data/tiles"
FRONTEND_MANIFESTS="$ROOT/frontend/public/manifests"

echo "Sync tiles -> tile server"
mkdir -p "$BACKEND_MB"
rsync -a --delete "$ETL_OUT/tiles/" "$BACKEND_MB/"

echo "Sync manifests -> frontend"
mkdir -p "$FRONTEND_MANIFESTS"
rsync -a --delete "$ETL_OUT/manifests/" "$FRONTEND_MANIFESTS/"

echo "Done."
