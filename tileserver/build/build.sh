#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Toggle stages.
RUN_VECTOR=1
RUN_COASTLINE=1
RUN_LAKE_SHORELINE=1
RUN_MERGE=1

# Shared inputs.
PLANET_INPUT="${DATA_DIR}/louisiana-260415.osm.pbf"
COASTLINE_INPUT="${DATA_DIR}/coastline.mbtiles"
BBOX="-94.1,28.8,-88.7,33.1"


THREADS="8"

# Vector basemap.
VECTOR_OUTPUT="${STATIC_DIR}/basemap-vector.mbtiles"
VECTOR_MAXZOOM="6"
VECTOR_BASEZOOM=""
INCLUDE_WATER_POLYGONS=0

# Marine coastline.
COASTLINE_OUTPUT="${STATIC_DIR}/coastline-simplified.mbtiles"
COASTLINE_LOW_SIMPLIFY_METERS="1500"
COASTLINE_LOW_MIN_FEATURE_LENGTH_METERS="3500"
COASTLINE_LOW_MINZOOM="0"
COASTLINE_LOW_MAXZOOM="6"
COASTLINE_LOW_BASEZOOM=""
COASTLINE_HIGH_SIMPLIFY_METERS="150"
COASTLINE_HIGH_MIN_FEATURE_LENGTH_METERS="300"
COASTLINE_HIGH_MINZOOM="7"
COASTLINE_HIGH_MAXZOOM="9"
COASTLINE_HIGH_BASEZOOM=""

# Inland shoreline.
LAKE_SHORELINE_OUTPUT="${STATIC_DIR}/lake-shoreline.mbtiles"
LAKE_LOW_SIMPLIFY_METERS="0"
LAKE_LOW_MIN_FEATURE_LENGTH_METERS="0"
LAKE_LOW_MINZOOM="2"
LAKE_LOW_MAXZOOM="6"
LAKE_LOW_BASEZOOM=""
LAKE_HIGH_SIMPLIFY_METERS="0"
LAKE_HIGH_MIN_FEATURE_LENGTH_METERS="0"
LAKE_HIGH_MINZOOM="7"
LAKE_HIGH_MAXZOOM="9"
LAKE_HIGH_BASEZOOM=""
LAKE_MIN_AREA_KM2="0"

# Final merge.
MERGED_OUTPUT="${STATIC_DIR}/basemap.mbtiles"

usage() {
  cat <<EOF
Run the full basemap build pipeline using the constants at the top of this file.

Edit the variables near the top of:
  ${SELF_DIR}/build.sh

Then run:
  $(basename "$0")

This wrapper intentionally does not accept build arguments. Configure it in one place instead.
EOF
}

append_if_set() {
  local value="$1"
  local flag="$2"

  if [[ -n "$value" ]]; then
    BUILD_CMD+=("$flag" "$value")
  fi
}

run_stage() {
  local name="$1"
  shift

  log "$name"
  run "$@"
}

if [[ $# -gt 0 ]]; then
  usage
  die "This wrapper does not accept command-line arguments."
fi

require_file "$PLANET_INPUT"
require_file "$COASTLINE_INPUT"

if [[ -n "$BBOX" ]]; then
  validate_bbox "$BBOX"
fi

validate_zoom_arg "VECTOR_MAXZOOM" "$VECTOR_MAXZOOM"
if [[ -n "$VECTOR_BASEZOOM" ]]; then
  validate_zoom_arg "VECTOR_BASEZOOM" "$VECTOR_BASEZOOM"
fi

validate_zoom_arg "COASTLINE_LOW_MINZOOM" "$COASTLINE_LOW_MINZOOM"
validate_zoom_arg "COASTLINE_LOW_MAXZOOM" "$COASTLINE_LOW_MAXZOOM"
if [[ -n "$COASTLINE_LOW_BASEZOOM" ]]; then
  validate_zoom_arg "COASTLINE_LOW_BASEZOOM" "$COASTLINE_LOW_BASEZOOM"
fi

if [[ -n "$COASTLINE_HIGH_MINZOOM" ]]; then
  validate_zoom_arg "COASTLINE_HIGH_MINZOOM" "$COASTLINE_HIGH_MINZOOM"
fi
if [[ -n "$COASTLINE_HIGH_MAXZOOM" ]]; then
  validate_zoom_arg "COASTLINE_HIGH_MAXZOOM" "$COASTLINE_HIGH_MAXZOOM"
fi
if [[ -n "$COASTLINE_HIGH_BASEZOOM" ]]; then
  validate_zoom_arg "COASTLINE_HIGH_BASEZOOM" "$COASTLINE_HIGH_BASEZOOM"
fi

validate_zoom_arg "LAKE_LOW_MINZOOM" "$LAKE_LOW_MINZOOM"
validate_zoom_arg "LAKE_LOW_MAXZOOM" "$LAKE_LOW_MAXZOOM"
if [[ -n "$LAKE_LOW_BASEZOOM" ]]; then
  validate_zoom_arg "LAKE_LOW_BASEZOOM" "$LAKE_LOW_BASEZOOM"
fi

if [[ -n "$LAKE_HIGH_MINZOOM" ]]; then
  validate_zoom_arg "LAKE_HIGH_MINZOOM" "$LAKE_HIGH_MINZOOM"
fi
if [[ -n "$LAKE_HIGH_MAXZOOM" ]]; then
  validate_zoom_arg "LAKE_HIGH_MAXZOOM" "$LAKE_HIGH_MAXZOOM"
fi
if [[ -n "$LAKE_HIGH_BASEZOOM" ]]; then
  validate_zoom_arg "LAKE_HIGH_BASEZOOM" "$LAKE_HIGH_BASEZOOM"
fi

log "Build configuration"
log "  PLANET_INPUT=$PLANET_INPUT"
log "  COASTLINE_INPUT=$COASTLINE_INPUT"
log "  BBOX=${BBOX:-<none>}"
log "  THREADS=$THREADS"
log "  VECTOR_MAXZOOM=$VECTOR_MAXZOOM"
log "  COASTLINE_LOW_SIMPLIFY_METERS=$COASTLINE_LOW_SIMPLIFY_METERS"
log "  COASTLINE_LOW_MIN_FEATURE_LENGTH_METERS=$COASTLINE_LOW_MIN_FEATURE_LENGTH_METERS"
log "  COASTLINE_LOW_MINZOOM=$COASTLINE_LOW_MINZOOM"
log "  COASTLINE_LOW_MAXZOOM=$COASTLINE_LOW_MAXZOOM"
log "  COASTLINE_HIGH_SIMPLIFY_METERS=${COASTLINE_HIGH_SIMPLIFY_METERS:-<disabled>}"
log "  COASTLINE_HIGH_MIN_FEATURE_LENGTH_METERS=${COASTLINE_HIGH_MIN_FEATURE_LENGTH_METERS:-<disabled>}"
log "  COASTLINE_HIGH_MINZOOM=${COASTLINE_HIGH_MINZOOM:-<disabled>}"
log "  COASTLINE_HIGH_MAXZOOM=${COASTLINE_HIGH_MAXZOOM:-<disabled>}"
log "  LAKE_LOW_SIMPLIFY_METERS=$LAKE_LOW_SIMPLIFY_METERS"
log "  LAKE_LOW_MIN_FEATURE_LENGTH_METERS=$LAKE_LOW_MIN_FEATURE_LENGTH_METERS"
log "  LAKE_LOW_MINZOOM=$LAKE_LOW_MINZOOM"
log "  LAKE_LOW_MAXZOOM=$LAKE_LOW_MAXZOOM"
log "  LAKE_HIGH_SIMPLIFY_METERS=${LAKE_HIGH_SIMPLIFY_METERS:-<disabled>}"
log "  LAKE_HIGH_MIN_FEATURE_LENGTH_METERS=${LAKE_HIGH_MIN_FEATURE_LENGTH_METERS:-<disabled>}"
log "  LAKE_HIGH_MINZOOM=${LAKE_HIGH_MINZOOM:-<disabled>}"
log "  LAKE_HIGH_MAXZOOM=${LAKE_HIGH_MAXZOOM:-<disabled>}"
log "  LAKE_MIN_AREA_KM2=$LAKE_MIN_AREA_KM2"

if (( RUN_VECTOR )); then
  BUILD_CMD=(
    "${SELF_DIR}/build-basemap-vector.sh"
    --planet-input "$PLANET_INPUT"
    --output "$VECTOR_OUTPUT"
    --threads "$THREADS"
    --maxzoom "$VECTOR_MAXZOOM"
  )
  append_if_set "$VECTOR_BASEZOOM" --basezoom
  append_if_set "$BBOX" --bbox
  if (( INCLUDE_WATER_POLYGONS )); then
    BUILD_CMD+=(--include-water-polygons)
  fi
  run_stage "Building vector basemap" "${BUILD_CMD[@]}"
fi

if (( RUN_COASTLINE )); then
  BUILD_CMD=(
    "${SELF_DIR}/build-coastline.sh"
    --coastline-input "$COASTLINE_INPUT"
    --output "$COASTLINE_OUTPUT"
    --low-simplify-meters "$COASTLINE_LOW_SIMPLIFY_METERS"
    --low-min-feature-length-meters "$COASTLINE_LOW_MIN_FEATURE_LENGTH_METERS"
    --low-minzoom "$COASTLINE_LOW_MINZOOM"
    --low-maxzoom "$COASTLINE_LOW_MAXZOOM"
  )
  append_if_set "$COASTLINE_LOW_BASEZOOM" --low-basezoom
  append_if_set "$COASTLINE_HIGH_SIMPLIFY_METERS" --high-simplify-meters
  append_if_set "$COASTLINE_HIGH_MIN_FEATURE_LENGTH_METERS" --high-min-feature-length-meters
  append_if_set "$COASTLINE_HIGH_MINZOOM" --high-minzoom
  append_if_set "$COASTLINE_HIGH_MAXZOOM" --high-maxzoom
  append_if_set "$COASTLINE_HIGH_BASEZOOM" --high-basezoom
  run_stage "Building simplified coastline" "${BUILD_CMD[@]}"
fi

if (( RUN_LAKE_SHORELINE )); then
  BUILD_CMD=(
    "${SELF_DIR}/build-lake-shoreline.sh"
    --planet-input "$PLANET_INPUT"
    --output "$LAKE_SHORELINE_OUTPUT"
    --low-simplify-meters "$LAKE_LOW_SIMPLIFY_METERS"
    --low-min-feature-length-meters "$LAKE_LOW_MIN_FEATURE_LENGTH_METERS"
    --low-minzoom "$LAKE_LOW_MINZOOM"
    --low-maxzoom "$LAKE_LOW_MAXZOOM"
    --min-area-km2 "$LAKE_MIN_AREA_KM2"
  )
  append_if_set "$LAKE_LOW_BASEZOOM" --low-basezoom
  append_if_set "$LAKE_HIGH_SIMPLIFY_METERS" --high-simplify-meters
  append_if_set "$LAKE_HIGH_MIN_FEATURE_LENGTH_METERS" --high-min-feature-length-meters
  append_if_set "$LAKE_HIGH_MINZOOM" --high-minzoom
  append_if_set "$LAKE_HIGH_MAXZOOM" --high-maxzoom
  append_if_set "$LAKE_HIGH_BASEZOOM" --high-basezoom
  append_if_set "$BBOX" --bbox
  run_stage "Building inland shoreline" "${BUILD_CMD[@]}"
fi

if (( RUN_MERGE )); then
  BUILD_CMD=(
    "${SELF_DIR}/merge-basemap.sh"
    --vector-input "$VECTOR_OUTPUT"
    --coastline-input "$COASTLINE_OUTPUT"
    --lake-shoreline-input "$LAKE_SHORELINE_OUTPUT"
    --output "$MERGED_OUTPUT"
  )
  run_stage "Merging basemap layers" "${BUILD_CMD[@]}"
fi

log "Build pipeline complete"
