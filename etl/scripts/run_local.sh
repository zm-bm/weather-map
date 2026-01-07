#!/usr/bin/env bash
set -euo pipefail

GRIB="./data/sample.grib2"
OUT="./out/tiles"

docker build -t gfs-worker:dev ./worker

docker run --rm \
  -v "$(pwd)/out:/out" \
  -v "$(pwd)/data:/data" \
  gfs-worker:dev \
  --input "/data/$(basename "$GRIB")" \
  --out "/out/tiles" \
  --cycle "2026010300" \
  --layer "temp2m" \
  --hour "000" \
  --min-zoom 0 --max-zoom 5 \
  --workdir "/data/workdir"
