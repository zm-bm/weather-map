#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PLANET_INPUT="${DATA_DIR}/iteration-gulf.osm.pbf"
OUTPUT_MBTILES="${STATIC_DIR}/lake-shoreline.mbtiles"
BBOX=""
SIMPLIFY_METERS="200"
MIN_FEATURE_LENGTH_METERS="100"
MIN_AREA_KM2="20"
MINZOOM="2"
MAXZOOM="9"
BASEZOOM=""
LOW_SIMPLIFY_METERS="1600"
LOW_MIN_FEATURE_LENGTH_METERS="0"
LOW_MERGE_DISTANCE_METERS="500"
LOW_MINZOOM="2"
LOW_MAXZOOM="6"
LOW_BASEZOOM="6"
HIGH_SIMPLIFY_METERS="600"
HIGH_MIN_FEATURE_LENGTH_METERS="0"
HIGH_MERGE_DISTANCE_METERS="350"
HIGH_MINZOOM="7"
HIGH_MAXZOOM="9"
HIGH_BASEZOOM="9"
TILE_BUFFER="14"
KEEP_WORKDIR=0
TILESET_NAME="weather-lake-shoreline"
TILESET_DESCRIPTION="Large inland shoreline linework for weather basemap"
SHORELINE_LAYER="lake_shoreline"
SOURCE_LAYER="multipolygons"

usage() {
  cat <<EOF
Build a dedicated inland shoreline MBTiles from large OSM water polygons.

Usage:
  $(basename "$0") [options]

Options:
  --planet-input PATH          Path to source OSM PBF
  --output PATH                Output inland shoreline MBTiles
  --bbox minlon,minlat,maxlon,maxlat
                               Limit the build to a temporary geographic subset
  --simplify-meters N          Simplify shoreline geometry in meters
  --min-feature-length-meters N
                               Drop simplified shorelines shorter than N meters
  --min-area-km2 N             Drop source water polygons smaller than N square km
  --minzoom N                  Minimum zoom in the output MBTiles (default: ${MINZOOM})
  --maxzoom N                  Maximum zoom in the output MBTiles (default: ${MAXZOOM})
  --basezoom N                 tippecanoe base zoom (defaults to --maxzoom)
  --low-simplify-meters N      Simplification tolerance for the low zoom band
  --low-min-feature-length-meters N
                               Minimum feature length for the low zoom band
  --low-merge-distance-meters N
                               Smooth and merge nearby low-band water polygons by buffering out and back by N meters before taking the boundary
  --low-minzoom N              Minimum zoom for the low zoom band
  --low-maxzoom N              Maximum zoom for the low zoom band
  --low-basezoom N             Base zoom for the low zoom band (defaults to low maxzoom)
  --high-simplify-meters N     Simplification tolerance for the high zoom band
  --high-min-feature-length-meters N
                               Minimum feature length for the high zoom band
  --high-merge-distance-meters N
                               Smooth and merge nearby high-band water polygons by buffering out and back by N meters before taking the boundary
  --high-minzoom N             Minimum zoom for the high zoom band
  --high-maxzoom N             Maximum zoom for the high zoom band
  --high-basezoom N            Base zoom for the high zoom band (defaults to high maxzoom)
  --tile-buffer N              Tippecanoe tile buffer in tile pixels (default: ${TILE_BUFFER})
  --keep-workdir               Keep temporary files in /tmp
  --help                       Show this message

Defaults:
  --planet-input               Auto-detect a single tileserver/data/planet-*.osm.pbf
  --output                     ${OUTPUT_MBTILES}
  --simplify-meters            ${SIMPLIFY_METERS}
  --min-feature-length-meters  ${MIN_FEATURE_LENGTH_METERS}
  --min-area-km2               ${MIN_AREA_KM2}
  --minzoom                    ${MINZOOM}
  --maxzoom                    ${MAXZOOM}
  --basezoom                   defaults to --maxzoom
  low zoom band                simplify=${LOW_SIMPLIFY_METERS} min_length=${LOW_MIN_FEATURE_LENGTH_METERS} merge_distance_m=${LOW_MERGE_DISTANCE_METERS} minzoom=${LOW_MINZOOM} maxzoom=${LOW_MAXZOOM}
  high zoom band               simplify=${HIGH_SIMPLIFY_METERS} min_length=${HIGH_MIN_FEATURE_LENGTH_METERS} merge_distance_m=${HIGH_MERGE_DISTANCE_METERS} minzoom=${HIGH_MINZOOM} maxzoom=${HIGH_MAXZOOM}

Examples:
  $(basename "$0") --planet-input ${DATA_DIR}/louisiana-260415.osm.pbf
  $(basename "$0") --planet-input ${DATA_DIR}/louisiana-260415.osm.pbf --bbox -91.8,28.7,-88.7,31.2
  $(basename "$0") --simplify-meters 800 --min-feature-length-meters 500 --min-area-km2 10
  $(basename "$0") --low-simplify-meters 1000 --low-merge-distance-meters 600 --low-minzoom 2 --low-maxzoom 6 --high-simplify-meters 400 --high-merge-distance-meters 300 --high-minzoom 7 --high-maxzoom 9
EOF
}

validate_positive_number() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "Invalid ${name} value: $value"
}

detect_planet_input() {
  local matches=()

  shopt -s nullglob
  matches=("${DATA_DIR}"/planet-*.osm.pbf)
  shopt -u nullglob

  if [[ ${#matches[@]} -eq 0 ]]; then
    die "No planet file found under ${DATA_DIR}. Use --planet-input."
  fi

  if [[ ${#matches[@]} -gt 1 ]]; then
    die "Multiple planet files found under ${DATA_DIR}. Use --planet-input."
  fi

  PLANET_INPUT="${matches[0]}"
}

build_filtered_input() {
  local source_pbf="$PLANET_INPUT"
  local extracted="$WORKDIR/extracted.osm.pbf"
  local filtered="$WORKDIR/inland-water.osm.pbf"

  if [[ -n "$BBOX" ]]; then
    log "Extracting geographic subset"
    run osmium extract \
      --bbox "$BBOX" \
      --strategy complete_ways \
      --set-bounds \
      -O \
      -o "$extracted" \
      "$PLANET_INPUT"
    source_pbf="$extracted"
  fi

  log "Filtering OSM data to inland water polygons"
  run osmium tags-filter \
    -O \
    -o "$filtered" \
    "$source_pbf" \
    "wr/natural=water"

  printf '%s\n' "$filtered"
}

extract_inland_water_polygons() {
  local source_pbf="$1"
  local water_polygons="$WORKDIR/inland_water.gpkg"
  local -a cmd=(
    ogr2ogr
    -f GPKG
    "$water_polygons"
    "$source_pbf"
    "$SOURCE_LAYER"
    -nln inland_water
    -lco GEOMETRY_NAME=geometry
    -where "natural = 'water'"
    -t_srs EPSG:3857
    -skipfailures
  )

  if [[ -n "$BBOX" ]]; then
    local minlon minlat maxlon maxlat
    IFS=',' read -r minlon minlat maxlon maxlat <<<"$BBOX"
    cmd+=(-spat "$minlon" "$minlat" "$maxlon" "$maxlat")
  fi

  log "Extracting inland water polygons"
  run "${cmd[@]}"

  printf '%s\n' "$water_polygons"
}

derive_shoreline_lines() {
  local water_polygons="$1"
  local simplify_meters="$2"
  local min_feature_length_meters="$3"
  local merge_distance_meters="$4"
  local shoreline_seq="$5"
  local min_area_m2
  local polygon_expr="geometry"
  local dissolved_expr
  local boundary_expr
  local sql

  min_area_m2="$(awk -v km2="$MIN_AREA_KM2" 'BEGIN { printf "%.0f", km2 * 1000000 }')"
  if [[ "$simplify_meters" != "0" ]]; then
    polygon_expr="ST_SimplifyPreserveTopology(geometry, ${simplify_meters})"
  fi
  dissolved_expr="ST_UnaryUnion(ST_Collect(${polygon_expr}))"
  if [[ "$merge_distance_meters" != "0" ]]; then
    dissolved_expr="ST_Buffer(ST_Buffer(${dissolved_expr}, ${merge_distance_meters}), -${merge_distance_meters})"
  fi
  boundary_expr="ST_Boundary(${dissolved_expr})"
  sql="SELECT geometry FROM (SELECT ${boundary_expr} AS geometry FROM inland_water WHERE ST_Area(geometry) >= ${min_area_m2})"
  if [[ "$min_feature_length_meters" != "0" ]]; then
    sql="${sql} WHERE ST_Length(geometry) >= ${min_feature_length_meters}"
  fi

  log "Deriving inland shoreline lines"
  run ogr2ogr \
    -f GeoJSONSeq \
    "$shoreline_seq" \
    "$water_polygons" \
    inland_water \
    -dialect sqlite \
    -sql "$sql" \
    -explodecollections \
    -t_srs EPSG:4326 \
    -skipfailures

  printf '%s\n' "$shoreline_seq"
}

build_shoreline_mbtiles() {
  local shoreline_seq="$1"
  local output_mbtiles="$2"
  local band_minzoom="$3"
  local band_maxzoom="$4"
  local band_basezoom="$5"
  local effective_basezoom="${band_basezoom:-$band_maxzoom}"

  log "Retiling inland shoreline lines"
  run tippecanoe \
    --force \
    --output="$output_mbtiles" \
    --layer="$SHORELINE_LAYER" \
    --name="$TILESET_NAME" \
    --description="$TILESET_DESCRIPTION" \
    --minimum-zoom="$band_minzoom" \
    --maximum-zoom="$band_maxzoom" \
    --base-zoom="$effective_basezoom" \
    --buffer="$TILE_BUFFER" \
    --read-parallel \
    "$shoreline_seq"

  metadata_upsert "$output_mbtiles" "type" "overlay"
  metadata_upsert "$output_mbtiles" "version" "$VERSION"
}

merge_shoreline_mbtiles() {
  local output_mbtiles="$1"
  shift
  local inputs=("$@")

  mkdir -p "$(dirname "$output_mbtiles")"
  rm -f "$output_mbtiles"

  log "Merging lake shoreline zoom bands"
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
  [[ -n "$1" || -n "$2" || -n "$3" || -n "$4" || -n "$5" || -n "$6" ]]
}

validate_band() {
  local prefix="$1"
  local simplify_meters="$2"
  local min_feature_length_meters="$3"
  local merge_distance_meters="$4"
  local minzoom="$5"
  local maxzoom="$6"
  local basezoom="$7"

  validate_positive_number "--${prefix}-simplify-meters" "$simplify_meters"
  validate_positive_number "--${prefix}-min-feature-length-meters" "$min_feature_length_meters"
  validate_positive_number "--${prefix}-merge-distance-meters" "$merge_distance_meters"
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
    --planet-input)
      PLANET_INPUT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_MBTILES="$2"
      shift 2
      ;;
    --bbox)
      BBOX="$2"
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
    --min-area-km2)
      MIN_AREA_KM2="$2"
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
    --low-merge-distance-meters)
      LOW_MERGE_DISTANCE_METERS="$2"
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
    --high-merge-distance-meters)
      HIGH_MERGE_DISTANCE_METERS="$2"
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

require_cmd awk
require_cmd ogr2ogr
require_cmd osmium
require_cmd sqlite3
require_cmd tippecanoe
require_cmd tile-join

if [[ -z "$PLANET_INPUT" ]]; then
  detect_planet_input
fi

require_file "$PLANET_INPUT"

if [[ -n "$BBOX" ]]; then
  validate_bbox "$BBOX"
fi

validate_positive_number "--simplify-meters" "$SIMPLIFY_METERS"
validate_positive_number "--min-feature-length-meters" "$MIN_FEATURE_LENGTH_METERS"
validate_positive_number "--min-area-km2" "$MIN_AREA_KM2"
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
if band_is_configured "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_FEATURE_LENGTH_METERS" "$HIGH_MERGE_DISTANCE_METERS" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"; then
  HIGH_BAND_ENABLED=1
  [[ -n "$HIGH_SIMPLIFY_METERS" ]] || die "--high-simplify-meters is required when configuring the high zoom band"
  [[ -n "$HIGH_MIN_FEATURE_LENGTH_METERS" ]] || die "--high-min-feature-length-meters is required when configuring the high zoom band"
  [[ -n "$HIGH_MERGE_DISTANCE_METERS" ]] || die "--high-merge-distance-meters is required when configuring the high zoom band"
  [[ -n "$HIGH_MINZOOM" ]] || die "--high-minzoom is required when configuring the high zoom band"
  [[ -n "$HIGH_MAXZOOM" ]] || die "--high-maxzoom is required when configuring the high zoom band"
  if [[ -z "$HIGH_BASEZOOM" ]]; then
    HIGH_BASEZOOM="$HIGH_MAXZOOM"
  fi
fi

validate_band "low" "$LOW_SIMPLIFY_METERS" "$LOW_MIN_FEATURE_LENGTH_METERS" "$LOW_MERGE_DISTANCE_METERS" "$LOW_MINZOOM" "$LOW_MAXZOOM" "$LOW_BASEZOOM"
if (( HIGH_BAND_ENABLED )); then
  validate_band "high" "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_FEATURE_LENGTH_METERS" "$HIGH_MERGE_DISTANCE_METERS" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"
  if (( HIGH_MINZOOM <= LOW_MAXZOOM )); then
    log "Lake shoreline zoom bands overlap at z${HIGH_MINZOOM}-z${LOW_MAXZOOM}; overlapping tiles will contain duplicate shoreline features"
  elif (( HIGH_MINZOOM > LOW_MAXZOOM + 1 )); then
    log "Lake shoreline zoom bands have a gap between z${LOW_MAXZOOM} and z${HIGH_MINZOOM}"
  fi
fi

log "Using source PBF: $PLANET_INPUT"
log "Output lake shoreline MBTiles: $OUTPUT_MBTILES"
log "Lake shoreline settings: min_area_km2=$MIN_AREA_KM2 bbox=${BBOX:-<none>}"
log "Lake shoreline tile buffer: $TILE_BUFFER"
log "Lake shoreline low band: simplify_meters=$LOW_SIMPLIFY_METERS min_feature_length_meters=$LOW_MIN_FEATURE_LENGTH_METERS merge_distance_meters=$LOW_MERGE_DISTANCE_METERS minzoom=$LOW_MINZOOM maxzoom=$LOW_MAXZOOM basezoom=$LOW_BASEZOOM"
if (( HIGH_BAND_ENABLED )); then
  log "Lake shoreline high band: simplify_meters=$HIGH_SIMPLIFY_METERS min_feature_length_meters=$HIGH_MIN_FEATURE_LENGTH_METERS merge_distance_meters=$HIGH_MERGE_DISTANCE_METERS minzoom=$HIGH_MINZOOM maxzoom=$HIGH_MAXZOOM basezoom=$HIGH_BASEZOOM"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-lake-shoreline.XXXXXX")"
cleanup() {
  if (( KEEP_WORKDIR )); then
    log "Keeping workdir: $WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

FILTERED_INPUT="$(build_filtered_input)"
WATER_POLYGONS="$(extract_inland_water_polygons "$FILTERED_INPUT")"
LOW_SEQ="$WORKDIR/lake-shoreline-low.geojsonseq"
LOW_MBTILES="$WORKDIR/lake-shoreline-low.mbtiles"
derive_shoreline_lines "$WATER_POLYGONS" "$LOW_SIMPLIFY_METERS" "$LOW_MIN_FEATURE_LENGTH_METERS" "$LOW_MERGE_DISTANCE_METERS" "$LOW_SEQ" >/dev/null
BUILT_BANDS=()

if seq_has_features "$LOW_SEQ"; then
  build_shoreline_mbtiles "$LOW_SEQ" "$LOW_MBTILES" "$LOW_MINZOOM" "$LOW_MAXZOOM" "$LOW_BASEZOOM"
  BUILT_BANDS+=("$LOW_MBTILES")
else
  log "Lake shoreline low band produced no features; skipping"
fi

if (( HIGH_BAND_ENABLED )); then
  HIGH_SEQ="$WORKDIR/lake-shoreline-high.geojsonseq"
  HIGH_MBTILES="$WORKDIR/lake-shoreline-high.mbtiles"
  derive_shoreline_lines "$WATER_POLYGONS" "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_FEATURE_LENGTH_METERS" "$HIGH_MERGE_DISTANCE_METERS" "$HIGH_SEQ" >/dev/null
  if seq_has_features "$HIGH_SEQ"; then
    build_shoreline_mbtiles "$HIGH_SEQ" "$HIGH_MBTILES" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"
    BUILT_BANDS+=("$HIGH_MBTILES")
  else
    log "Lake shoreline high band produced no features; skipping"
  fi
fi

mkdir -p "$(dirname "$OUTPUT_MBTILES")"
rm -f "$OUTPUT_MBTILES"

if [[ ${#BUILT_BANDS[@]} -eq 0 ]]; then
  log "Lake shoreline build produced no features for any zoom band; skipping output"
elif [[ ${#BUILT_BANDS[@]} -eq 1 ]]; then
  run cp "${BUILT_BANDS[0]}" "$OUTPUT_MBTILES"
  metadata_upsert "$OUTPUT_MBTILES" "name" "$TILESET_NAME"
  metadata_upsert "$OUTPUT_MBTILES" "description" "$TILESET_DESCRIPTION"
  metadata_upsert "$OUTPUT_MBTILES" "type" "overlay"
  metadata_upsert "$OUTPUT_MBTILES" "version" "$VERSION"
else
  merge_shoreline_mbtiles "$OUTPUT_MBTILES" "${BUILT_BANDS[@]}"
fi

log "Lake shoreline ready: $OUTPUT_MBTILES"
