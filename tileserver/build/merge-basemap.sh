#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

VECTOR_INPUT="${STATIC_DIR}/basemap-vector.mbtiles"
COASTLINE_INPUT="${STATIC_DIR}/coastline-simplified.mbtiles"
LAKE_SHORELINE_INPUT="${STATIC_DIR}/lake-shoreline.mbtiles"
OUTPUT_MBTILES="${STATIC_DIR}/basemap.mbtiles"
TILESET_NAME="weather-basemap"
TILESET_DESCRIPTION="Merged weather basemap with simplified coastline and inland shoreline"

usage() {
  cat <<EOF
Merge the basemap vector core and simplified coastline into the final basemap.

Usage:
  $(basename "$0") [options]

Options:
  --vector-input PATH          Path to basemap vector MBTiles
  --coastline-input PATH       Path to simplified coastline MBTiles
  --lake-shoreline-input PATH  Path to inland shoreline MBTiles
  --output PATH                Output merged basemap MBTiles
  --help                       Show this message

Defaults:
  --vector-input               ${VECTOR_INPUT}
  --coastline-input            ${COASTLINE_INPUT}
  --lake-shoreline-input       ${LAKE_SHORELINE_INPUT} if present
  --output                     ${OUTPUT_MBTILES}

Examples:
  $(basename "$0")
  $(basename "$0") --output /tmp/basemap-merged.mbtiles
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vector-input)
      VECTOR_INPUT="$2"
      shift 2
      ;;
    --coastline-input)
      COASTLINE_INPUT="$2"
      shift 2
      ;;
    --lake-shoreline-input)
      LAKE_SHORELINE_INPUT="$2"
      shift 2
      ;;
    --output)
      OUTPUT_MBTILES="$2"
      shift 2
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

require_cmd tile-join
require_cmd sqlite3

require_file "$VECTOR_INPUT"
require_file "$COASTLINE_INPUT"
ensure_vector_layer "$COASTLINE_INPUT" "coastline"

MERGE_INPUTS=("$VECTOR_INPUT" "$COASTLINE_INPUT")

if [[ -f "$LAKE_SHORELINE_INPUT" ]]; then
  ensure_vector_layer "$LAKE_SHORELINE_INPUT" "lake_shoreline"
  MERGE_INPUTS+=("$LAKE_SHORELINE_INPUT")
fi

log "Using vector MBTiles: $VECTOR_INPUT"
log "Using coastline MBTiles: $COASTLINE_INPUT"
if [[ -f "$LAKE_SHORELINE_INPUT" ]]; then
  log "Using lake shoreline MBTiles: $LAKE_SHORELINE_INPUT"
else
  log "Lake shoreline MBTiles not found, skipping: $LAKE_SHORELINE_INPUT"
fi
log "Output merged basemap: $OUTPUT_MBTILES"

mkdir -p "$(dirname "$OUTPUT_MBTILES")"
rm -f "$OUTPUT_MBTILES"

log "Merging vector core with simplified coastline"
run tile-join \
  -f \
  -o "$OUTPUT_MBTILES" \
  "${MERGE_INPUTS[@]}"

metadata_upsert "$OUTPUT_MBTILES" "name" "$TILESET_NAME"
metadata_upsert "$OUTPUT_MBTILES" "description" "$TILESET_DESCRIPTION"
metadata_upsert "$OUTPUT_MBTILES" "type" "overlay"
metadata_upsert "$OUTPUT_MBTILES" "version" "$VERSION"

log "Basemap ready: $OUTPUT_MBTILES"
