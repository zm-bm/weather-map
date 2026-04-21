#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TILESERVER_DIR="${REPO_ROOT}/tileserver"
DEFAULT_INPUT_DIR="${TILESERVER_DIR}/data"
DEFAULT_STATIC_DIR="${TILESERVER_DIR}/static"
DEFAULT_WORK_DIR="/tmp"

ZOOM=""
INPUT=""
INPUT_DIR="${DEFAULT_INPUT_DIR}"
OUTPUT=""
WORK_DIR="${DEFAULT_WORK_DIR}"
KEEP_TEMP=0

usage() {
  cat <<'EOF'
Build a Terrarium-encoded DEM MBTiles from GeoTIFF inputs.

Usage:
  ./tileserver/scripts/build-dem.sh --zoom 6 [options]

Options:
  --zoom N            Required. Output max zoom to build.
  --input PATH        Single source GeoTIFF or VRT to use directly.
  --input-dir PATH    Directory containing GeoTIFF tiles.
                      Defaults to tileserver/data
  --output PATH       Output MBTiles path.
                      Defaults to tileserver/static/dem-z{zoom}.mbtiles
  --work-dir PATH     Temporary working directory root. Defaults to /tmp
  --keep-temp         Keep temporary files instead of deleting them.
  --help              Show this help.

Notes:
  - This script encodes the DEM using the Terrarium scheme, which preserves
    the full elevation range without clipping values below -10000 m.
  - If --input is omitted, the script will read all *.tif files in --input-dir.
  - Martin can serve the resulting MBTiles directly from tileserver/static/.
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zoom)
      [[ $# -ge 2 ]] || fail "--zoom requires a value"
      ZOOM="$2"
      shift 2
      ;;
    --input)
      [[ $# -ge 2 ]] || fail "--input requires a value"
      INPUT="$2"
      shift 2
      ;;
    --input-dir)
      [[ $# -ge 2 ]] || fail "--input-dir requires a value"
      INPUT_DIR="$2"
      shift 2
      ;;
    --output)
      [[ $# -ge 2 ]] || fail "--output requires a value"
      OUTPUT="$2"
      shift 2
      ;;
    --work-dir)
      [[ $# -ge 2 ]] || fail "--work-dir requires a value"
      WORK_DIR="$2"
      shift 2
      ;;
    --keep-temp)
      KEEP_TEMP=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "${ZOOM}" ]] || fail "--zoom is required"
[[ "${ZOOM}" =~ ^[0-9]+$ ]] || fail "--zoom must be a non-negative integer"

require_command gdalwarp
require_command gdal_translate
require_command gdaladdo
require_command gdalbuildvrt
require_command python3

python3 - <<'PY' >/dev/null 2>&1 || fail "Python packages 'numpy' and 'rasterio' are required"
import numpy
import rasterio
PY

mkdir -p "${DEFAULT_STATIC_DIR}" "${WORK_DIR}"

if [[ -z "${INPUT}" ]]; then
  [[ -d "${INPUT_DIR}" ]] || fail "Input directory does not exist: ${INPUT_DIR}"
fi

WORLD_PIXELS=$((256 << ZOOM))
OUTPUT="${OUTPUT:-${DEFAULT_STATIC_DIR}/dem-z${ZOOM}.mbtiles}"
TMP_DIR="$(mktemp -d "${WORK_DIR%/}/dem-z${ZOOM}.XXXXXX")"

cleanup() {
  if [[ "${KEEP_TEMP}" -eq 1 ]]; then
    echo "Kept temp files in ${TMP_DIR}" >&2
  else
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

SOURCE_PATH="${INPUT}"
if [[ -z "${SOURCE_PATH}" ]]; then
  mapfile -t tif_files < <(find "${INPUT_DIR}" -maxdepth 1 -type f -name '*.tif' | sort)
  [[ "${#tif_files[@]}" -gt 0 ]] || fail "No .tif files found in ${INPUT_DIR}"

  if [[ "${#tif_files[@]}" -eq 1 ]]; then
    SOURCE_PATH="${tif_files[0]}"
  else
    SOURCE_PATH="${TMP_DIR}/dem.vrt"
    echo "Building VRT from ${#tif_files[@]} GeoTIFF tiles..."
    gdalbuildvrt "${SOURCE_PATH}" "${tif_files[@]}"
  fi
fi

[[ -f "${SOURCE_PATH}" ]] || fail "Input file does not exist: ${SOURCE_PATH}"

WARPED_TIF="${TMP_DIR}/dem_3857_z${ZOOM}.tif"
ENCODED_TIF="${TMP_DIR}/dem_terrarium_z${ZOOM}.tif"

echo "Warping source to EPSG:3857 at z${ZOOM} world resolution (${WORLD_PIXELS}x${WORLD_PIXELS})..."
gdalwarp \
  -overwrite \
  -t_srs EPSG:3857 \
  -te_srs EPSG:4326 -te -180 -85.05112878 180 85.05112878 \
  -r bilinear \
  -ts "${WORLD_PIXELS}" "${WORLD_PIXELS}" \
  -dstnodata -32768 \
  -multi \
  -wo NUM_THREADS=ALL_CPUS \
  -co TILED=YES \
  -co COMPRESS=DEFLATE \
  -co BIGTIFF=YES \
  "${SOURCE_PATH}" \
  "${WARPED_TIF}"

echo "Encoding DEM as Terrarium RGB..."
python3 - "${WARPED_TIF}" "${ENCODED_TIF}" <<'PY'
import sys

import numpy as np
import rasterio

src_path, dst_path = sys.argv[1], sys.argv[2]

with rasterio.open(src_path) as src:
    dem = src.read(1, masked=False).astype("float32")
    nodata = src.nodata
    valid = np.isfinite(dem)
    if nodata is not None:
        valid &= dem != nodata

    terrarium = np.zeros_like(dem, dtype=np.float32)
    terrarium[valid] = dem[valid] + 32768.0
    terrarium = np.clip(terrarium, 0.0, 65535.99609375)

    red = np.floor(terrarium / 256.0).astype("uint8")
    green = np.floor(terrarium % 256.0).astype("uint8")
    blue = np.floor((terrarium - np.floor(terrarium)) * 256.0).astype("uint8")

    red[~valid] = 0
    green[~valid] = 0
    blue[~valid] = 0

    profile = src.profile.copy()
    profile.update(
        driver="GTiff",
        dtype="uint8",
        count=3,
        nodata=None,
        compress="deflate",
        tiled=True,
        predictor=2,
        interleave="pixel",
    )

    with rasterio.open(dst_path, "w", **profile) as dst:
        dst.write(red, 1)
        dst.write(green, 2)
        dst.write(blue, 3)
PY

echo "Writing MBTiles to ${OUTPUT}..."
rm -f "${OUTPUT}"
gdal_translate \
  -of MBTILES \
  -co TILE_FORMAT=PNG \
  -co TYPE=overlay \
  -co NAME="dem-z${ZOOM}" \
  -co DESCRIPTION="Terrarium DEM z${ZOOM}" \
  -co ZOOM_LEVEL_STRATEGY=LOWER \
  "${ENCODED_TIF}" \
  "${OUTPUT}"

overview_factors=()
factor=2
max_factor=$((1 << ZOOM))
while (( factor <= max_factor )); do
  overview_factors+=("${factor}")
  factor=$((factor * 2))
done

if [[ "${#overview_factors[@]}" -gt 0 ]]; then
  echo "Building lower zoom overviews..."
  gdaladdo -r nearest "${OUTPUT}" "${overview_factors[@]}"
fi

cat <<EOF
Done.

Output:
  ${OUTPUT}

Frontend source settings:
  type: raster-dem
  encoding: terrarium
  maxzoom: ${ZOOM}
EOF
