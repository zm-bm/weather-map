#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

COASTLINE_INPUT="${DATA_DIR}/coastline.mbtiles"
OUTPUT_MBTILES="${STATIC_DIR}/coastline-simplified.mbtiles"
SIMPLIFY_METERS="1500"
MIN_FEATURE_LENGTH_METERS="3500"
MINZOOM="0"
MAXZOOM="9"
BASEZOOM=""
LOW_SIMPLIFY_METERS="1500"
LOW_MIN_FEATURE_LENGTH_METERS="5000"
LOW_MINZOOM="0"
LOW_MAXZOOM="6"
LOW_BASEZOOM="6"
HIGH_SIMPLIFY_METERS="150"
HIGH_MIN_FEATURE_LENGTH_METERS="500"
HIGH_MINZOOM="7"
HIGH_MAXZOOM="9"
HIGH_BASEZOOM="9"
TILE_BUFFER="14"
KEEP_WORKDIR=0
COASTLINE_LAYER="coastline"
TILESET_NAME="weather-coastline-simplified"
TILESET_DESCRIPTION="Simplified coastline linework for weather basemap"

usage() {
  cat <<EOF
Build a simplified coastline MBTiles from coastline.mbtiles.

Usage:
  $(basename "$0") [options]

Options:
  --coastline-input PATH       Path to source coastline MBTiles
  --output PATH                Output simplified coastline MBTiles
  --simplify-meters N          Geometric simplification tolerance in meters
  --min-feature-length-meters N
                               Drop simplified coastline fragments shorter than N meters
  --minzoom N                  Minimum zoom in the output MBTiles (default: 0)
  --maxzoom N                  Maximum zoom in the output MBTiles (default: 6)
  --basezoom N                 tippecanoe base zoom (defaults to --maxzoom)
  --low-simplify-meters N      Simplification tolerance for the low zoom band
  --low-min-feature-length-meters N
                               Minimum feature length for the low zoom band
  --low-minzoom N              Minimum zoom for the low zoom band
  --low-maxzoom N              Maximum zoom for the low zoom band
  --low-basezoom N             Base zoom for the low zoom band (defaults to low maxzoom)
  --high-simplify-meters N     Simplification tolerance for the high zoom band
  --high-min-feature-length-meters N
                               Minimum feature length for the high zoom band
  --high-minzoom N             Minimum zoom for the high zoom band
  --high-maxzoom N             Maximum zoom for the high zoom band
  --high-basezoom N            Base zoom for the high zoom band (defaults to high maxzoom)
  --tile-buffer N              Tippecanoe tile buffer in tile pixels (default: ${TILE_BUFFER})
  --keep-workdir               Keep temporary files in /tmp
  --help                       Show this message

Defaults:
  --coastline-input            ${COASTLINE_INPUT}
  --output                     ${OUTPUT_MBTILES}
  low zoom band                simplify=${LOW_SIMPLIFY_METERS} min_length=${LOW_MIN_FEATURE_LENGTH_METERS} minzoom=${LOW_MINZOOM} maxzoom=${LOW_MAXZOOM}
  high zoom band               simplify=${HIGH_SIMPLIFY_METERS} min_length=${HIGH_MIN_FEATURE_LENGTH_METERS} minzoom=${HIGH_MINZOOM} maxzoom=${HIGH_MAXZOOM}
  --basezoom                   defaults to the active band's maxzoom

Examples:
  $(basename "$0")
  $(basename "$0") --simplify-meters 1500 --maxzoom 7
  $(basename "$0") --output /tmp/coastline-simplified.mbtiles --simplify-meters 7000
  $(basename "$0") --simplify-meters 7000 --min-feature-length-meters 1500
  $(basename "$0") --low-simplify-meters 7000 --low-min-feature-length-meters 2000 --low-minzoom 0 --low-maxzoom 6 --high-simplify-meters 500 --high-min-feature-length-meters 200 --high-minzoom 7 --high-maxzoom 9
EOF
}

validate_positive_number() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "Invalid ${name} value: $value"
}

extract_and_simplify() {
  local simplify_meters="$1"
  local min_feature_length_meters="$2"
  local simplified_seq="$3"
  local sql="SELECT ST_Simplify(geometry, ${simplify_meters}) AS geometry FROM \"${COASTLINE_LAYER}\""

  if [[ "$min_feature_length_meters" != "0" ]]; then
    sql="SELECT ST_Simplify(geometry, ${simplify_meters}) AS geometry FROM \"${COASTLINE_LAYER}\" WHERE ST_Length(ST_Simplify(geometry, ${simplify_meters})) >= ${min_feature_length_meters}"
  fi

  log "Extracting and simplifying coastline geometry"
  run ogr2ogr \
    -f GeoJSONSeq \
    "$simplified_seq" \
    "$COASTLINE_INPUT" \
    -dialect sqlite \
    -sql "$sql" \
    -t_srs EPSG:4326 \
    -skipfailures

  printf '%s\n' "$simplified_seq"
}

build_coastline_mbtiles() {
  local simplified_seq="$1"
  local output_mbtiles="$2"
  local band_minzoom="$3"
  local band_maxzoom="$4"
  local band_basezoom="$5"
  local effective_basezoom="${band_basezoom:-$band_maxzoom}"

  log "Retiling simplified coastline"
  run tippecanoe \
    --force \
    --output="$output_mbtiles" \
    --layer="$COASTLINE_LAYER" \
    --name="$TILESET_NAME" \
    --description="$TILESET_DESCRIPTION" \
    --minimum-zoom="$band_minzoom" \
    --maximum-zoom="$band_maxzoom" \
    --base-zoom="$effective_basezoom" \
    --buffer="$TILE_BUFFER" \
    --read-parallel \
    "$simplified_seq"

  metadata_upsert "$output_mbtiles" "type" "overlay"
  metadata_upsert "$output_mbtiles" "version" "$VERSION"
}

merge_coastline_mbtiles() {
  local output_mbtiles="$1"
  shift
  local inputs=("$@")

  mkdir -p "$(dirname "$output_mbtiles")"
  rm -f "$output_mbtiles"

  log "Merging coastline zoom bands"
  run tile-join \
    -f \
    -o "$output_mbtiles" \
    "${inputs[@]}"

  metadata_upsert "$output_mbtiles" "name" "$TILESET_NAME"
  metadata_upsert "$output_mbtiles" "description" "$TILESET_DESCRIPTION"
  metadata_upsert "$output_mbtiles" "type" "overlay"
  metadata_upsert "$output_mbtiles" "version" "$VERSION"
}

seq_has_features() {
  local seq_path="$1"
  [[ -s "$seq_path" ]]
}

band_is_configured() {
  [[ -n "$1" || -n "$2" || -n "$3" || -n "$4" || -n "$5" ]]
}

validate_band() {
  local prefix="$1"
  local simplify_meters="$2"
  local min_feature_length_meters="$3"
  local minzoom="$4"
  local maxzoom="$5"
  local basezoom="$6"

  validate_positive_number "--${prefix}-simplify-meters" "$simplify_meters"
  validate_positive_number "--${prefix}-min-feature-length-meters" "$min_feature_length_meters"
  validate_zoom_arg "--${prefix}-minzoom" "$minzoom"
  validate_zoom_arg "--${prefix}-maxzoom" "$maxzoom"
  if [[ -n "$basezoom" ]]; then
    validate_zoom_arg "--${prefix}-basezoom" "$basezoom"
  fi
  (( minzoom <= maxzoom )) || die "--${prefix}-minzoom must be less than or equal to --${prefix}-maxzoom"
  if [[ -n "$basezoom" ]]; then
    (( basezoom <= maxzoom )) || die "--${prefix}-basezoom must be less than or equal to --${prefix}-maxzoom"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --coastline-input)
      COASTLINE_INPUT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_MBTILES="$2"
      shift 2
      ;;
    --simplify-meters)
      SIMPLIFY_METERS="$2"
      shift 2
      ;;
    --min-feature-length-meters)
      MIN_FEATURE_LENGTH_METERS="$2"
      shift 2
      ;;
    --minzoom)
      MINZOOM="$2"
      shift 2
      ;;
    --maxzoom)
      MAXZOOM="$2"
      shift 2
      ;;
    --basezoom)
      BASEZOOM="$2"
      shift 2
      ;;
    --low-simplify-meters)
      LOW_SIMPLIFY_METERS="$2"
      shift 2
      ;;
    --low-min-feature-length-meters)
      LOW_MIN_FEATURE_LENGTH_METERS="$2"
      shift 2
      ;;
    --low-minzoom)
      LOW_MINZOOM="$2"
      shift 2
      ;;
    --low-maxzoom)
      LOW_MAXZOOM="$2"
      shift 2
      ;;
    --low-basezoom)
      LOW_BASEZOOM="$2"
      shift 2
      ;;
    --high-simplify-meters)
      HIGH_SIMPLIFY_METERS="$2"
      shift 2
      ;;
    --high-min-feature-length-meters)
      HIGH_MIN_FEATURE_LENGTH_METERS="$2"
      shift 2
      ;;
    --high-minzoom)
      HIGH_MINZOOM="$2"
      shift 2
      ;;
    --high-maxzoom)
      HIGH_MAXZOOM="$2"
      shift 2
      ;;
    --high-basezoom)
      HIGH_BASEZOOM="$2"
      shift 2
      ;;
    --tile-buffer)
      TILE_BUFFER="$2"
      shift 2
      ;;
    --keep-workdir)
      KEEP_WORKDIR=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage
      die "Unknown argument: $1"
      ;;
  esac
done

require_cmd ogr2ogr
require_cmd sqlite3
require_cmd tippecanoe
require_cmd tile-join

require_file "$COASTLINE_INPUT"
ensure_vector_layer "$COASTLINE_INPUT" "$COASTLINE_LAYER"

validate_positive_number "--simplify-meters" "$SIMPLIFY_METERS"
validate_positive_number "--min-feature-length-meters" "$MIN_FEATURE_LENGTH_METERS"
validate_zoom_arg "--minzoom" "$MINZOOM"
validate_zoom_arg "--maxzoom" "$MAXZOOM"
if [[ -n "$BASEZOOM" ]]; then
  validate_zoom_arg "--basezoom" "$BASEZOOM"
else
  BASEZOOM="$MAXZOOM"
fi
validate_zoom_arg "--tile-buffer" "$TILE_BUFFER"
(( MINZOOM <= MAXZOOM )) || die "--minzoom must be less than or equal to --maxzoom"
(( BASEZOOM <= MAXZOOM )) || die "--basezoom must be less than or equal to --maxzoom"

if [[ -z "$LOW_SIMPLIFY_METERS" ]]; then
  LOW_SIMPLIFY_METERS="$SIMPLIFY_METERS"
fi
if [[ -z "$LOW_MIN_FEATURE_LENGTH_METERS" ]]; then
  LOW_MIN_FEATURE_LENGTH_METERS="$MIN_FEATURE_LENGTH_METERS"
fi
if [[ -z "$LOW_MINZOOM" ]]; then
  LOW_MINZOOM="$MINZOOM"
fi
if [[ -z "$LOW_MAXZOOM" ]]; then
  LOW_MAXZOOM="$MAXZOOM"
fi
if [[ -z "$LOW_BASEZOOM" ]]; then
  LOW_BASEZOOM="$BASEZOOM"
fi

HIGH_BAND_ENABLED=0
if band_is_configured "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_FEATURE_LENGTH_METERS" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"; then
  HIGH_BAND_ENABLED=1
  [[ -n "$HIGH_SIMPLIFY_METERS" ]] || die "--high-simplify-meters is required when configuring the high zoom band"
  [[ -n "$HIGH_MIN_FEATURE_LENGTH_METERS" ]] || die "--high-min-feature-length-meters is required when configuring the high zoom band"
  [[ -n "$HIGH_MINZOOM" ]] || die "--high-minzoom is required when configuring the high zoom band"
  [[ -n "$HIGH_MAXZOOM" ]] || die "--high-maxzoom is required when configuring the high zoom band"
  if [[ -z "$HIGH_BASEZOOM" ]]; then
    HIGH_BASEZOOM="$HIGH_MAXZOOM"
  fi
fi

validate_band "low" "$LOW_SIMPLIFY_METERS" "$LOW_MIN_FEATURE_LENGTH_METERS" "$LOW_MINZOOM" "$LOW_MAXZOOM" "$LOW_BASEZOOM"
if (( HIGH_BAND_ENABLED )); then
  validate_band "high" "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_FEATURE_LENGTH_METERS" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"
  if (( HIGH_MINZOOM <= LOW_MAXZOOM )); then
    log "Coastline zoom bands overlap at z${HIGH_MINZOOM}-z${LOW_MAXZOOM}; overlapping tiles will contain duplicate coastline features"
  elif (( HIGH_MINZOOM > LOW_MAXZOOM + 1 )); then
    log "Coastline zoom bands have a gap between z${LOW_MAXZOOM} and z${HIGH_MINZOOM}"
  fi
fi

log "Using coastline MBTiles: $COASTLINE_INPUT"
log "Output simplified coastline MBTiles: $OUTPUT_MBTILES"
log "Coastline tile buffer: $TILE_BUFFER"
log "Coastline low band: simplify_meters=$LOW_SIMPLIFY_METERS min_feature_length_meters=$LOW_MIN_FEATURE_LENGTH_METERS minzoom=$LOW_MINZOOM maxzoom=$LOW_MAXZOOM basezoom=$LOW_BASEZOOM"
if (( HIGH_BAND_ENABLED )); then
  log "Coastline high band: simplify_meters=$HIGH_SIMPLIFY_METERS min_feature_length_meters=$HIGH_MIN_FEATURE_LENGTH_METERS minzoom=$HIGH_MINZOOM maxzoom=$HIGH_MAXZOOM basezoom=$HIGH_BASEZOOM"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-coastline.XXXXXX")"
cleanup() {
  if (( KEEP_WORKDIR )); then
    log "Keeping workdir: $WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

LOW_SEQ="$WORKDIR/coastline-low.geojsonseq"
LOW_MBTILES="$WORKDIR/coastline-low.mbtiles"
extract_and_simplify "$LOW_SIMPLIFY_METERS" "$LOW_MIN_FEATURE_LENGTH_METERS" "$LOW_SEQ" >/dev/null
BUILT_BANDS=()

if seq_has_features "$LOW_SEQ"; then
  build_coastline_mbtiles "$LOW_SEQ" "$LOW_MBTILES" "$LOW_MINZOOM" "$LOW_MAXZOOM" "$LOW_BASEZOOM"
  BUILT_BANDS+=("$LOW_MBTILES")
else
  log "Coastline low band produced no features; skipping"
fi

if (( HIGH_BAND_ENABLED )); then
  HIGH_SEQ="$WORKDIR/coastline-high.geojsonseq"
  HIGH_MBTILES="$WORKDIR/coastline-high.mbtiles"
  extract_and_simplify "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_FEATURE_LENGTH_METERS" "$HIGH_SEQ" >/dev/null
  if seq_has_features "$HIGH_SEQ"; then
    build_coastline_mbtiles "$HIGH_SEQ" "$HIGH_MBTILES" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"
    BUILT_BANDS+=("$HIGH_MBTILES")
  else
    log "Coastline high band produced no features; skipping"
  fi
fi

mkdir -p "$(dirname "$OUTPUT_MBTILES")"
rm -f "$OUTPUT_MBTILES"

if [[ ${#BUILT_BANDS[@]} -eq 0 ]]; then
  log "Coastline build produced no features for any zoom band; skipping output"
elif [[ ${#BUILT_BANDS[@]} -eq 1 ]]; then
  run cp "${BUILT_BANDS[0]}" "$OUTPUT_MBTILES"
  metadata_upsert "$OUTPUT_MBTILES" "name" "$TILESET_NAME"
  metadata_upsert "$OUTPUT_MBTILES" "description" "$TILESET_DESCRIPTION"
  metadata_upsert "$OUTPUT_MBTILES" "type" "overlay"
  metadata_upsert "$OUTPUT_MBTILES" "version" "$VERSION"
else
  merge_coastline_mbtiles "$OUTPUT_MBTILES" "${BUILT_BANDS[@]}"
fi

log "Simplified coastline ready: $OUTPUT_MBTILES"
