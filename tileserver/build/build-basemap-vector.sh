#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PLANET_INPUT=""
OUTPUT_MBTILES="${STATIC_DIR}/basemap-vector.mbtiles"
BBOX=""
THREADS="0"
KEEP_WORKDIR=0
MAXZOOM="6"
BASEZOOM=""
INCLUDE_WATER_POLYGONS=0

TILEMAKER_CONFIG="${SELF_DIR}/tilemaker-basemap.json"
TILEMAKER_PROCESS="${SELF_DIR}/tilemaker-basemap.lua"
TILESET_NAME="weather-basemap-vector"
TILESET_DESCRIPTION="Planet-derived weather basemap layers without coastline"

usage() {
  cat <<EOF
Build the planet-derived basemap core MBTiles, without coastline.

Usage:
  $(basename "$0") [options]

Options:
  --planet-input PATH          Path to source OSM PBF
  --output PATH                Output vector MBTiles
  --bbox minlon,minlat,maxlon,maxlat
                               Limit the build to a temporary geographic subset
  --threads N                  tilemaker thread count (0 = auto)
  --maxzoom N                  Cap generated tiles at zoom N (default: 6)
  --basezoom N                 tilemaker basezoom (defaults to --maxzoom)
  --include-water-polygons     Include water polygons in the generated basemap
  --keep-workdir               Keep temporary files in /tmp
  --help                       Show this message

Defaults:
  --planet-input               Auto-detect a single tileserver/data/planet-*.osm.pbf
  --output                     ${OUTPUT_MBTILES}
  --maxzoom                    ${MAXZOOM}
  --basezoom                   defaults to --maxzoom
  --include-water-polygons     disabled

Examples:
  $(basename "$0")
  $(basename "$0") --planet-input ${DATA_DIR}/louisiana-260415.osm.pbf --output /tmp/basemap-vector-louisiana.mbtiles
  $(basename "$0") --planet-input ${DATA_DIR}/louisiana-260415.osm.pbf --maxzoom 6 --output /tmp/basemap-vector-louisiana-z6.mbtiles
EOF
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

build_filter_expressions() {
  local place_filter="n/place=country,city"
  local highway_filter=""
  local expressions=(
    "wr/boundary=administrative"
  )

  if (( MAXZOOM >= 8 )); then
    place_filter="n/place=country,city,town"
  fi

  expressions+=("$place_filter")

  if (( MAXZOOM >= 7 )); then
    highway_filter="w/highway=motorway,trunk"
    expressions+=("wr/waterway=river")
  elif (( MAXZOOM >= 6 )); then
    highway_filter="w/highway=motorway"
  fi

  if [[ -n "$highway_filter" ]]; then
    expressions+=("$highway_filter")
  fi

  if (( INCLUDE_WATER_POLYGONS )); then
    expressions+=(
      "wr/natural=water,coastline"
      "wr/water"
      "wr/waterway=riverbank"
    )
  fi

  printf '%s\n' "${expressions[@]}"
}

describe_layer_selection() {
  local transport_layers="none"
  local place_layers="country,city"
  local waterway_layers="none"

  if (( MAXZOOM >= 8 )); then
    place_layers="country,city,town"
  fi

  if (( MAXZOOM >= 7 )); then
    transport_layers="motorway,trunk"
    waterway_layers="river"
  elif (( MAXZOOM >= 6 )); then
    transport_layers="motorway"
  fi

  printf 'places=%s transportation=%s waterway=%s boundaries=admin2,admin4' \
    "$place_layers" \
    "$transport_layers" \
    "$waterway_layers"
}

prepare_tilemaker_config() {
  local runtime_config="$WORKDIR/tilemaker-basemap.json"
  local effective_basezoom="${BASEZOOM:-$MAXZOOM}"

  cp "$TILEMAKER_CONFIG" "$runtime_config"
  sed -E -i \
    -e "s/\"maxzoom\": 9/\"maxzoom\": ${MAXZOOM}/g" \
    -e "s/\"basezoom\": 9/\"basezoom\": ${effective_basezoom}/" \
    -e "s/\"simplify_below\": 9/\"simplify_below\": ${MAXZOOM}/g" \
    -e "s/\"combine_polygons_below\": 9/\"combine_polygons_below\": ${MAXZOOM}/g" \
    -e "s/\"combine_lines_below\": 9/\"combine_lines_below\": ${MAXZOOM}/g" \
    -e "s/\"combine_lines_below\": 8/\"combine_lines_below\": $(( MAXZOOM < 8 ? MAXZOOM : 8 ))/g" \
    "$runtime_config"

  log "Prepared tilemaker config (maxzoom=${MAXZOOM}, basezoom=${effective_basezoom})"
  printf '%s\n' "$runtime_config"
}

build_input_subset() {
  local extracted="$WORKDIR/extracted.osm.pbf"
  local filtered="$WORKDIR/filtered.osm.pbf"
  local source_pbf="$PLANET_INPUT"
  local -a filter_expressions=()

  mapfile -t filter_expressions < <(build_filter_expressions)

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

  log "Filtering OSM data to required tags"
  run osmium tags-filter \
    -O \
    -o "$filtered" \
    "$source_pbf" \
    "${filter_expressions[@]}"

  printf '%s\n' "$filtered"
}

build_vector_mbtiles() {
  local filtered_pbf="$1"
  local runtime_config="$2"
  local output_mbtiles="$WORKDIR/basemap-vector.mbtiles"
  local store_dir="$WORKDIR/tilemaker-store"
  local -a cmd=(
    env
    "BUILD_MAXZOOM=${MAXZOOM}"
    "INCLUDE_WATER_POLYGONS=${INCLUDE_WATER_POLYGONS}"
    tilemaker
    --input "$filtered_pbf"
    --output "$output_mbtiles"
    --config "$runtime_config"
    --process "$TILEMAKER_PROCESS"
    --store "$store_dir"
    --threads "$THREADS"
  )

  mkdir -p "$store_dir"

  if [[ -n "$BBOX" ]]; then
    cmd+=( --bbox "$BBOX" )
  fi

  log "Running tilemaker"
  run "${cmd[@]}"
  log "tilemaker finished: $output_mbtiles"

  printf '%s\n' "$output_mbtiles"
}

finalize_output() {
  local built_mbtiles="$1"

  mkdir -p "$(dirname "$OUTPUT_MBTILES")"
  rm -f "$OUTPUT_MBTILES"
  run cp "$built_mbtiles" "$OUTPUT_MBTILES"

  metadata_upsert "$OUTPUT_MBTILES" "name" "$TILESET_NAME"
  metadata_upsert "$OUTPUT_MBTILES" "description" "$TILESET_DESCRIPTION"
  metadata_upsert "$OUTPUT_MBTILES" "type" "overlay"
  metadata_upsert "$OUTPUT_MBTILES" "version" "$VERSION"
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
    --threads)
      THREADS="$2"
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
    --include-water-polygons)
      INCLUDE_WATER_POLYGONS=1
      shift
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

require_cmd osmium
require_cmd tilemaker
require_cmd sqlite3

require_file "$TILEMAKER_CONFIG"
require_file "$TILEMAKER_PROCESS"

if [[ -z "$PLANET_INPUT" ]]; then
  detect_planet_input
fi

if [[ -n "$BBOX" ]]; then
  validate_bbox "$BBOX"
fi

validate_zoom_arg "--maxzoom" "$MAXZOOM"
if [[ -n "$BASEZOOM" ]]; then
  validate_zoom_arg "--basezoom" "$BASEZOOM"
else
  BASEZOOM="$MAXZOOM"
fi
(( BASEZOOM <= MAXZOOM )) || die "--basezoom must be less than or equal to --maxzoom"

require_file "$PLANET_INPUT"

log "Using source PBF: $PLANET_INPUT"
log "Output vector MBTiles: $OUTPUT_MBTILES"
log "Build settings: maxzoom=$MAXZOOM basezoom=$BASEZOOM threads=$THREADS include_water_polygons=$INCLUDE_WATER_POLYGONS bbox=${BBOX:-<none>}"
log "Layer selection: $(describe_layer_selection)"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-vector.XXXXXX")"
cleanup() {
  if (( KEEP_WORKDIR )); then
    log "Keeping workdir: $WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

RUNTIME_TILEMAKER_CONFIG="$(prepare_tilemaker_config)"
FILTERED_PBF="$(build_input_subset)"
BUILT_MBTILES="$(build_vector_mbtiles "$FILTERED_PBF" "$RUNTIME_TILEMAKER_CONFIG")"
finalize_output "$BUILT_MBTILES"

log "Basemap vector ready: $OUTPUT_MBTILES"
