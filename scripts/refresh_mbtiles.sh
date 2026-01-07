#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1) Run ETL
"$ROOT/etl/scripts/run_local.sh"

# 2) Sync output into backend
mkdir -p "$ROOT/backend/mbtiles"
rsync -a --delete "$ROOT/etl/out/tiles/" "$ROOT/backend/mbtiles/"

echo "Synced ETL output -> backend/mbtiles"