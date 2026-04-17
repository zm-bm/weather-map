#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PLANET_INPUT="${DATA_DIR}/iteration.osm.pbf"
OUTPUT_PBF="${DATA_DIR}/iteration-gulf.osm.pbf"
BBOX="-100.5,22.5,-87.0,33.8"
PROFILE="all"
KEEP_WORKDIR=0
INCLUDE_WATER_POLYGONS=1
INCLUDE_TOWNS=1

usage() {
  cat <<EOF
Build a filtered OSM PBF for fast local iteration on the weather basemap pipeline.

Usage:
  $(basename "$0") [options]

Options:
  --planet-input PATH          Path to source OSM PBF
  --output PATH                Output filtered PBF
  --bbox minlon,minlat,maxlon,maxlat
                               Limit the output to a geographic subset
  --profile NAME               Filter profile: vector, lake, or all (default: all)
  --include-water-polygons     Include water polygon source tags in vector/all profiles
  --exclude-water-polygons     Exclude water polygon source tags in vector/all profiles
  --include-towns              Include town places in vector/all profiles
  --exclude-towns              Exclude town places in vector/all profiles
  --keep-workdir               Keep temporary files in /tmp
  --help                       Show this message

Defaults:
  --planet-input               Auto-detect a single tileserver/data/planet-*.osm.pbf
  --output                     ${OUTPUT_PBF}
  --profile                    ${PROFILE}
  --include-water-polygons     enabled
  --include-towns              enabled

Examples:
  $(basename "$0")
  $(basename "$0") --bbox -161,18,-154,23 --output ${DATA_DIR}/iteration-hawaii.osm.pbf
  $(basename "$0") --profile vector --exclude-water-polygons --output ${DATA_DIR}/iteration-vector.osm.pbf
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
  local expressions=()
  local place_filter="n/place=country,city"

  if (( INCLUDE_TOWNS )); then
    place_filter="n/place=country,city,town"
  fi

  case "$PROFILE" in
    vector|lake|all)
      ;;
    *)
      die "Unsupported --profile value: $PROFILE"
      ;;
  esac

  if [[ "$PROFILE" == "vector" || "$PROFILE" == "all" ]]; then
    expressions+=(
      "wr/boundary=administrative"
      "w/natural=coastline"
      "$place_filter"
      "w/highway=motorway,trunk"
      "wr/waterway=river"
    )

    if (( INCLUDE_WATER_POLYGONS )); then
      expressions+=(
        "wr/natural=water"
        "wr/water"
        "wr/waterway=riverbank"
      )
    fi
  fi

  if [[ "$PROFILE" == "lake" || "$PROFILE" == "all" ]]; then
    expressions+=("wr/natural=water")
  fi

  printf '%s\n' "${expressions[@]}" | awk '!seen[$0]++'
}

build_filtered_pbf() {
  local source_pbf="$PLANET_INPUT"
  local extracted="$WORKDIR/extracted.osm.pbf"
  local expressions_file="$WORKDIR/filter-expressions.txt"
  local -a expressions=()

  mapfile -t expressions < <(build_filter_expressions)
  printf '%s\n' "${expressions[@]}" > "$expressions_file"

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

  log "Filtering OSM data for profile '$PROFILE'"
  run osmium tags-filter \
    -O \
    -o "$OUTPUT_PBF" \
    --expressions="$expressions_file" \
    "$source_pbf"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --planet-input)
      PLANET_INPUT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_PBF="$2"
      shift 2
      ;;
    --bbox)
      BBOX="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --include-water-polygons)
      INCLUDE_WATER_POLYGONS=1
      shift
      ;;
    --exclude-water-polygons)
      INCLUDE_WATER_POLYGONS=0
      shift
      ;;
    --include-towns)
      INCLUDE_TOWNS=1
      shift
      ;;
    --exclude-towns)
      INCLUDE_TOWNS=0
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

require_cmd awk
require_cmd osmium

if [[ -z "$PLANET_INPUT" ]]; then
  detect_planet_input
fi

require_file "$PLANET_INPUT"
if [[ -n "$BBOX" ]]; then
  validate_bbox "$BBOX"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-iteration-pbf.XXXXXX")"
cleanup() {
  if (( KEEP_WORKDIR )); then
    log "Keeping workdir: $WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

log "Using source PBF: $PLANET_INPUT"
log "Output filtered PBF: $OUTPUT_PBF"
log "Iteration profile: $PROFILE"
log "Include water polygons: $INCLUDE_WATER_POLYGONS"
log "Include towns: $INCLUDE_TOWNS"
log "BBOX: ${BBOX:-<none>}"

mkdir -p "$(dirname "$OUTPUT_PBF")"
build_filtered_pbf

log "Iteration PBF ready: $OUTPUT_PBF"
