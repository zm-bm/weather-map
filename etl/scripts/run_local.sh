#!/usr/bin/env bash
set -euo pipefail

# ------------------------------
# Config
# ------------------------------

# Cycle string like YYYYMMDDHH
CYCLE="2026011412"

# Forecast hour (FHR) like 000, 003, 006...
HOUR="000"

# Layer key (must exist in etl/worker/src/worker.py LAYER_CFG)
LAYER="temp2m"

# Zoom range
MIN_ZOOM=0
MAX_ZOOM=5

# Input GRIB
GRIB_REL="data/sample.grib2"

# Docker image tag
IMAGE_TAG="gfs-worker:dev"

# Whether to build the image each run (1=yes, 0=no)
DO_BUILD=1

# Worker workdir inside the container (stored under the mounted /data volume)
WORKDIR="/data/workdir"

# ------------------------------
# Paths
# ------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ETL_DIR="$(dirname "$SCRIPT_DIR")"

GRIB="$ETL_DIR/$GRIB_REL"
if [[ ! -f "$GRIB" ]]; then
  echo "GRIB not found: $GRIB" >&2
  exit 1
fi

mkdir -p "$ETL_DIR/out" "$ETL_DIR/data"

# ------------------------------
# Build (optional)
# ------------------------------
if [[ "$DO_BUILD" -eq 1 ]]; then
  docker build -t "$IMAGE_TAG" "$ETL_DIR/worker"
fi

# ------------------------------
# Run
# ------------------------------
docker run --rm \
  -v "$ETL_DIR/out:/out" \
  -v "$ETL_DIR/data:/data" \
  "$IMAGE_TAG" \
  --input "/data/$(basename "$GRIB")" \
  --out "/out/tiles" \
  --cycle "$CYCLE" \
  --layer "$LAYER" \
  --hour "$HOUR" \
  --min-zoom "$MIN_ZOOM" --max-zoom "$MAX_ZOOM" \
  --workdir "$WORKDIR"
