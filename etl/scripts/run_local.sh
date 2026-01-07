#!/usr/bin/env bash
set -euo pipefail

# Get paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ETL_DIR="$(dirname "$SCRIPT_DIR")"
GRIB="$ETL_DIR/data/sample.grib2"

# Build Docker image
docker build -t gfs-worker:dev "$ETL_DIR/worker"

# Run ETL inside Docker
docker run --rm \
  -v "$ETL_DIR/out:/out" \
  -v "$ETL_DIR/data:/data" \
  gfs-worker:dev \
  --input "/data/$(basename "$GRIB")" \
  --out "/out/tiles" \
  --cycle "2026010300" \
  --layer "temp2m" \
  --hour "000" \
  --min-zoom 0 --max-zoom 5 \
  --workdir "/data/workdir"
