#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

COASTLINE_INPUT="${DATA_DIR}/coastline.osm.pbf"
OUTPUT_DATABASE="${DATA_DIR}/coastline.db"
OUTPUT_MBTILES="${STATIC_DIR}/coastline-simplified.mbtiles"
SRS="3857"
CLOSE_DISTANCE="200"
OUTPUT_LINES=1
OUTPUT_POLYGONS=""
OUTPUT_RINGS=0
LOW_SIMPLIFY_METERS="2800"
LOW_MIN_CLOSED_FEATURE_LENGTH_METERS="15000"
LOW_MIN_AREA_KM2="10"
LOW_MERGE_DISTANCE_METERS="2200"
LOW_MINZOOM="0"
LOW_MAXZOOM="4"
LOW_BASEZOOM="4"
MID_SIMPLIFY_METERS="1100"
MID_MIN_CLOSED_FEATURE_LENGTH_METERS="6000"
MID_MIN_AREA_KM2="1"
MID_MERGE_DISTANCE_METERS="700"
MID_MINZOOM="5"
MID_MAXZOOM="8"
MID_BASEZOOM="8"
HIGH_SIMPLIFY_METERS="300"
HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS="2000"
HIGH_MINZOOM="9"
HIGH_MAXZOOM="9"
HIGH_BASEZOOM="9"
BUILD_BANDS="all"
TILE_BUFFER="14"
KEEP_WORKDIR=0
VERBOSE=0
COASTLINE_LINE_TABLE="lines"
COASTLINE_POLYGON_TABLE="land_polygons"
COASTLINE_LAYER="coastline"
TILESET_NAME="weather-coastline-simplified"
TILESET_DESCRIPTION="Simplified assembled coastline lines from osmcoastline"

usage() {
  cat <<EOF
Build an assembled coastline Spatialite database from coastline-filtered OSM input.

Usage:
  $(basename "$0") [options]

Options:
  --coastline-input PATH       Path to coastline-filtered OSM PBF input
  --output-database PATH       Output Spatialite database path
  --srs EPSGCODE               Output database projection: 3857 or 4326 (default: ${SRS})
  --output PATH                Output coastline MBTiles path
  --close-distance DISTANCE    Close coastline gaps smaller than DISTANCE
  --bands MODE                 Build coastline bands: all, low, mid, high, or a comma-separated combination (default: ${BUILD_BANDS})
  --output-lines               Include assembled coastline lines (default)
  --no-output-lines            Do not write assembled coastline lines
  --output-polygons MODE       Polygon output passed to osmcoastline: land, water, both, or none
                               Default is auto: land when low band is enabled, none for high-only builds
  --low-simplify-meters N      Simplify low-band coastline lines by N meters with ST_SimplifyPreserveTopology (default: ${LOW_SIMPLIFY_METERS})
  --low-min-closed-feature-length-meters N
                               Drop closed low-band coastline loops shorter than N meters after simplification (default: ${LOW_MIN_CLOSED_FEATURE_LENGTH_METERS}, open lines are never dropped)
  --low-min-area-km2 N         Drop low-band land polygons smaller than N square km before dissolve (default: ${LOW_MIN_AREA_KM2})
  --low-merge-distance-meters N
                               Merge nearby low-band land polygons by buffering out and back by N meters before taking the boundary (default: ${LOW_MERGE_DISTANCE_METERS})
  --low-minzoom N              Minimum zoom in the low band (default: ${LOW_MINZOOM})
  --low-maxzoom N              Maximum zoom in the low band (default: ${LOW_MAXZOOM})
  --low-basezoom N             tippecanoe base zoom for the low band (default: ${LOW_BASEZOOM})
  --mid-simplify-meters N      Simplify mid-band coastline lines by N meters with ST_SimplifyPreserveTopology (default: ${MID_SIMPLIFY_METERS})
  --mid-min-closed-feature-length-meters N
                               Drop closed mid-band coastline loops shorter than N meters after simplification (default: ${MID_MIN_CLOSED_FEATURE_LENGTH_METERS}, open lines are never dropped)
  --mid-min-area-km2 N         Drop mid-band land polygons smaller than N square km before dissolve (default: ${MID_MIN_AREA_KM2})
  --mid-merge-distance-meters N
                               Merge nearby mid-band land polygons by buffering out and back by N meters before taking the boundary (default: ${MID_MERGE_DISTANCE_METERS})
  --mid-minzoom N              Minimum zoom in the mid band (default: ${MID_MINZOOM})
  --mid-maxzoom N              Maximum zoom in the mid band (default: ${MID_MAXZOOM})
  --mid-basezoom N             tippecanoe base zoom for the mid band (default: ${MID_BASEZOOM})
  --high-simplify-meters N     Simplify high-band coastline lines by N meters with ST_SimplifyPreserveTopology (default: ${HIGH_SIMPLIFY_METERS})
  --high-min-closed-feature-length-meters N
                               Drop closed high-band coastline loops shorter than N meters after simplification (default: ${HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS}, open lines are never dropped)
  --high-minzoom N             Minimum zoom in the high band (default: ${HIGH_MINZOOM})
  --high-maxzoom N             Maximum zoom in the high band (default: ${HIGH_MAXZOOM})
  --high-basezoom N            tippecanoe base zoom for the high band (default: ${HIGH_BASEZOOM})
  --tile-buffer N              Tippecanoe tile buffer in tile pixels (default: ${TILE_BUFFER})
  --output-rings               Include intermediate coastline rings for debugging
  --keep-workdir               Keep temporary export files in /tmp
  --verbose                    Pass --verbose to osmcoastline
  --help                       Show this message

Defaults:
  --coastline-input            ${COASTLINE_INPUT}
  --output-database            ${OUTPUT_DATABASE}
  --output                     ${OUTPUT_MBTILES}
  --srs                        ${SRS}
  --bands                      ${BUILD_BANDS}
  --output-lines               enabled
  --output-polygons            auto
  low zoom band                simplify=${LOW_SIMPLIFY_METERS} min_closed_length=${LOW_MIN_CLOSED_FEATURE_LENGTH_METERS} min_area_km2=${LOW_MIN_AREA_KM2} merge_distance_m=${LOW_MERGE_DISTANCE_METERS} minzoom=${LOW_MINZOOM} maxzoom=${LOW_MAXZOOM} basezoom=${LOW_BASEZOOM}
  mid zoom band                simplify=${MID_SIMPLIFY_METERS} min_closed_length=${MID_MIN_CLOSED_FEATURE_LENGTH_METERS} min_area_km2=${MID_MIN_AREA_KM2} merge_distance_m=${MID_MERGE_DISTANCE_METERS} minzoom=${MID_MINZOOM} maxzoom=${MID_MAXZOOM} basezoom=${MID_BASEZOOM}
  high zoom band               simplify=${HIGH_SIMPLIFY_METERS} min_closed_length=${HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS} minzoom=${HIGH_MINZOOM} maxzoom=${HIGH_MAXZOOM} basezoom=${HIGH_BASEZOOM}

Examples:
  $(basename "$0")
  $(basename "$0") --close-distance 200
  $(basename "$0") --bands high
  $(basename "$0") --bands low
  $(basename "$0") --bands mid
  $(basename "$0") --bands low,mid
  $(basename "$0") --low-simplify-meters 2500 --low-min-closed-feature-length-meters 12000
  $(basename "$0") --low-simplify-meters 2200 --low-min-area-km2 5 --low-merge-distance-meters 1500
  $(basename "$0") --mid-simplify-meters 1000 --mid-min-area-km2 1 --mid-merge-distance-meters 600
  $(basename "$0") --high-simplify-meters 200 --high-min-closed-feature-length-meters 1500
  $(basename "$0") --output-polygons land --output-rings
  $(basename "$0") --output ${STATIC_DIR}/coastline.mbtiles
  $(basename "$0") --coastline-input ${DATA_DIR}/coastline.osm.pbf --output-database /tmp/coastline.db --output /tmp/coastline.mbtiles
EOF
}

validate_srs() {
  local value="$1"
  [[ "$value" == "3857" || "$value" == "4326" ]] || die "--srs must be 3857 or 4326: $value"
}

validate_output_polygons() {
  local value="$1"
  [[ "$value" == "land" || "$value" == "water" || "$value" == "both" || "$value" == "none" ]] \
    || die "--output-polygons must be one of: land, water, both, none"
}

validate_bands() {
  local value="$1"
  local band
  local seen=0

  [[ -n "$value" ]] || die "--bands must not be empty"

  if [[ "$value" == "all" ]]; then
    return 0
  fi

  IFS=',' read -r -a requested_bands <<<"$value"
  for band in "${requested_bands[@]}"; do
    case "$band" in
      low|mid|high)
        seen=1
        ;;
      *)
        die "--bands must be all, or a comma-separated list of: low, mid, high"
        ;;
    esac
  done

  (( seen )) || die "--bands must be all, or a comma-separated list of: low, mid, high"
}

validate_non_negative_number() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "Invalid ${name} value: $value"
}

build_line_export_sql() {
  local simplify_meters="$1"
  local min_closed_feature_length_meters="$2"
  local geometry_expr="geometry"
  local sql

  if [[ "$simplify_meters" != "0" ]]; then
    geometry_expr="ST_SimplifyPreserveTopology(geometry, ${simplify_meters})"
  fi

  sql="SELECT ${geometry_expr} AS geometry FROM \"${COASTLINE_LINE_TABLE}\""

  if [[ "$min_closed_feature_length_meters" != "0" ]]; then
    sql="SELECT ${geometry_expr} AS geometry FROM \"${COASTLINE_LINE_TABLE}\" WHERE NOT ST_IsClosed(geometry) OR ST_Length(${geometry_expr}) >= ${min_closed_feature_length_meters}"
  fi

  printf '%s\n' "$sql"
}

build_polygon_boundary_export_sql() {
  local simplify_meters="$1"
  local min_closed_feature_length_meters="$2"
  local min_area_km2="$3"
  local merge_distance_meters="$4"
  local min_area_m2
  local polygon_expr="geometry"
  local dissolved_expr
  local boundary_expr
  local where_clause="1=1"
  local sql

  if [[ "$simplify_meters" != "0" ]]; then
    polygon_expr="ST_SimplifyPreserveTopology(geometry, ${simplify_meters})"
  fi

  if [[ "$min_area_km2" != "0" ]]; then
    min_area_m2="$(awk -v km2="$min_area_km2" 'BEGIN { printf "%.0f", km2 * 1000000 }')"
    where_clause="ST_Area(${polygon_expr}) >= ${min_area_m2}"
  fi

  dissolved_expr="ST_UnaryUnion(ST_Collect(${polygon_expr}))"

  if [[ "$merge_distance_meters" != "0" ]]; then
    dissolved_expr="ST_Buffer(ST_Buffer(${dissolved_expr}, ${merge_distance_meters}), -${merge_distance_meters})"
  fi

  boundary_expr="ST_Boundary(${dissolved_expr})"
  sql="SELECT geometry FROM (SELECT ${boundary_expr} AS geometry FROM \"${COASTLINE_POLYGON_TABLE}\" WHERE ${where_clause})"

  if [[ "$min_closed_feature_length_meters" != "0" ]]; then
    sql="SELECT geometry FROM (SELECT ${boundary_expr} AS geometry FROM \"${COASTLINE_POLYGON_TABLE}\" WHERE ${where_clause}) WHERE ST_Length(geometry) >= ${min_closed_feature_length_meters}"
  fi

  printf '%s\n' "$sql"
}

export_coastline_lines() {
  local output_seq="$1"
  local sql="$2"

  log "Exporting assembled coastline lines"
  run ogr2ogr \
    -f GeoJSONSeq \
    "$output_seq" \
    "$OUTPUT_DATABASE" \
    -dialect sqlite \
    -sql "$sql" \
    -explodecollections \
    -t_srs EPSG:4326 \
    -skipfailures
}

build_coastline_mbtiles() {
  local input_seq="$1"
  local output_mbtiles="$2"
  local band_minzoom="$3"
  local band_maxzoom="$4"
  local band_basezoom="$5"
  local effective_basezoom="${band_basezoom:-$band_maxzoom}"

  log "Retiling assembled coastline"
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
    "$input_seq"

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

validate_band() {
  local prefix="$1"
  local simplify_meters="$2"
  local min_closed_feature_length_meters="$3"
  local minzoom="$4"
  local maxzoom="$5"
  local basezoom="$6"

  validate_non_negative_number "--${prefix}-simplify-meters" "$simplify_meters"
  validate_non_negative_number "--${prefix}-min-closed-feature-length-meters" "$min_closed_feature_length_meters"
  validate_zoom_arg "--${prefix}-minzoom" "$minzoom"
  validate_zoom_arg "--${prefix}-maxzoom" "$maxzoom"
  validate_zoom_arg "--${prefix}-basezoom" "$basezoom"
  (( minzoom <= maxzoom )) || die "--${prefix}-minzoom must be less than or equal to --${prefix}-maxzoom"
  (( basezoom <= maxzoom )) || die "--${prefix}-basezoom must be less than or equal to --${prefix}-maxzoom"
}

validate_low_polygon_band() {
  validate_non_negative_number "--low-min-area-km2" "$LOW_MIN_AREA_KM2"
  validate_non_negative_number "--low-merge-distance-meters" "$LOW_MERGE_DISTANCE_METERS"
}

validate_mid_polygon_band() {
  validate_non_negative_number "--mid-min-area-km2" "$MID_MIN_AREA_KM2"
  validate_non_negative_number "--mid-merge-distance-meters" "$MID_MERGE_DISTANCE_METERS"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --coastline-input)
      COASTLINE_INPUT="$2"
      shift 2
      ;;
    --output-database)
      OUTPUT_DATABASE="$2"
      shift 2
      ;;
    --output)
      OUTPUT_MBTILES="$2"
      shift 2
      ;;
    --srs)
      SRS="$2"
      shift 2
      ;;
    --close-distance)
      CLOSE_DISTANCE="$2"
      shift 2
      ;;
    --bands)
      BUILD_BANDS="$2"
      shift 2
      ;;
    --low-simplify-meters)
      LOW_SIMPLIFY_METERS="$2"
      shift 2
      ;;
    --low-min-closed-feature-length-meters)
      LOW_MIN_CLOSED_FEATURE_LENGTH_METERS="$2"
      shift 2
      ;;
    --low-min-area-km2)
      LOW_MIN_AREA_KM2="$2"
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
    --mid-simplify-meters)
      MID_SIMPLIFY_METERS="$2"
      shift 2
      ;;
    --mid-min-closed-feature-length-meters)
      MID_MIN_CLOSED_FEATURE_LENGTH_METERS="$2"
      shift 2
      ;;
    --mid-min-area-km2)
      MID_MIN_AREA_KM2="$2"
      shift 2
      ;;
    --mid-merge-distance-meters)
      MID_MERGE_DISTANCE_METERS="$2"
      shift 2
      ;;
    --mid-minzoom)
      MID_MINZOOM="$2"
      shift 2
      ;;
    --mid-maxzoom)
      MID_MAXZOOM="$2"
      shift 2
      ;;
    --mid-basezoom)
      MID_BASEZOOM="$2"
      shift 2
      ;;
    --high-simplify-meters)
      HIGH_SIMPLIFY_METERS="$2"
      shift 2
      ;;
    --high-min-closed-feature-length-meters)
      HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS="$2"
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
    --output-lines)
      OUTPUT_LINES=1
      shift
      ;;
    --no-output-lines)
      OUTPUT_LINES=0
      shift
      ;;
    --output-polygons)
      OUTPUT_POLYGONS="$2"
      shift 2
      ;;
    --output-rings)
      OUTPUT_RINGS=1
      shift
      ;;
    --keep-workdir)
      KEEP_WORKDIR=1
      shift
      ;;
    --verbose)
      VERBOSE=1
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

require_cmd osmcoastline
require_cmd ogr2ogr
require_cmd tippecanoe
require_cmd tile-join
require_cmd sqlite3
require_file "$COASTLINE_INPUT"
validate_srs "$SRS"
validate_bands "$BUILD_BANDS"
if [[ -n "$OUTPUT_POLYGONS" ]]; then
  validate_output_polygons "$OUTPUT_POLYGONS"
fi
if [[ -n "$CLOSE_DISTANCE" ]]; then
  validate_non_negative_number "--close-distance" "$CLOSE_DISTANCE"
fi
validate_zoom_arg "--tile-buffer" "$TILE_BUFFER"
validate_band "low" "$LOW_SIMPLIFY_METERS" "$LOW_MIN_CLOSED_FEATURE_LENGTH_METERS" "$LOW_MINZOOM" "$LOW_MAXZOOM" "$LOW_BASEZOOM"
validate_low_polygon_band
validate_band "mid" "$MID_SIMPLIFY_METERS" "$MID_MIN_CLOSED_FEATURE_LENGTH_METERS" "$MID_MINZOOM" "$MID_MAXZOOM" "$MID_BASEZOOM"
validate_mid_polygon_band
validate_band "high" "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"
if (( MID_MINZOOM <= LOW_MAXZOOM )); then
  log "Coastline zoom bands overlap at z${MID_MINZOOM}-z${LOW_MAXZOOM}; overlapping low/mid tiles will contain duplicate coastline features"
elif (( MID_MINZOOM > LOW_MAXZOOM + 1 )); then
  log "Coastline zoom bands have a gap between z${LOW_MAXZOOM} and z${MID_MINZOOM}"
fi
if (( HIGH_MINZOOM <= MID_MAXZOOM )); then
  log "Coastline zoom bands overlap at z${HIGH_MINZOOM}-z${MID_MAXZOOM}; overlapping mid/high tiles will contain duplicate coastline features"
elif (( HIGH_MINZOOM > MID_MAXZOOM + 1 )); then
  log "Coastline zoom bands have a gap between z${MID_MAXZOOM} and z${HIGH_MINZOOM}"
fi
if [[ "$SRS" != "3857" ]]; then
  if [[ "$LOW_SIMPLIFY_METERS" != "0" || "$LOW_MIN_CLOSED_FEATURE_LENGTH_METERS" != "0" || "$MID_SIMPLIFY_METERS" != "0" || "$MID_MIN_CLOSED_FEATURE_LENGTH_METERS" != "0" || "$HIGH_SIMPLIFY_METERS" != "0" || "$HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS" != "0" ]]; then
    die "band simplification currently assumes --srs=3857 so tolerances are measured in meters"
  fi
fi

BUILD_LOW_BAND=0
BUILD_MID_BAND=0
BUILD_HIGH_BAND=0
if [[ "$BUILD_BANDS" == "all" ]]; then
  BUILD_LOW_BAND=1
  BUILD_MID_BAND=1
  BUILD_HIGH_BAND=1
else
  IFS=',' read -r -a requested_bands <<<"$BUILD_BANDS"
  for band in "${requested_bands[@]}"; do
    case "$band" in
      low)
        BUILD_LOW_BAND=1
        ;;
      mid)
        BUILD_MID_BAND=1
        ;;
      high)
        BUILD_HIGH_BAND=1
        ;;
    esac
  done
fi

if [[ -z "$OUTPUT_POLYGONS" ]]; then
  if (( BUILD_LOW_BAND || BUILD_MID_BAND )); then
    OUTPUT_POLYGONS="land"
  else
    OUTPUT_POLYGONS="none"
  fi
fi

if (( BUILD_LOW_BAND || BUILD_MID_BAND )) && [[ "$OUTPUT_POLYGONS" != "land" && "$OUTPUT_POLYGONS" != "both" ]]; then
  die "low/mid polygon bands require --output-polygons land or both"
fi

mkdir -p "$(dirname "$OUTPUT_DATABASE")"
rm -f "$OUTPUT_DATABASE"

cmd=(
  osmcoastline
  "--output-database=$OUTPUT_DATABASE"
  "--output-polygons=$OUTPUT_POLYGONS"
  "--srs=$SRS"
)

if (( OUTPUT_LINES )); then
  cmd+=( --output-lines )
fi

if (( OUTPUT_RINGS )); then
  cmd+=( --output-rings )
fi

if (( VERBOSE )); then
  cmd+=( --verbose )
fi

if [[ -n "$CLOSE_DISTANCE" ]]; then
  cmd+=( "--close-distance=$CLOSE_DISTANCE" )
fi

cmd+=( "$COASTLINE_INPUT" )

log "Using coastline-filtered OSM input: $COASTLINE_INPUT"
log "Output coastline database: $OUTPUT_DATABASE"
log "Output coastline MBTiles: $OUTPUT_MBTILES"
log "osmcoastline settings: srs=$SRS output_lines=$OUTPUT_LINES output_polygons=$OUTPUT_POLYGONS output_rings=$OUTPUT_RINGS close_distance=${CLOSE_DISTANCE:-default}"
log "building bands: $BUILD_BANDS"
if (( BUILD_LOW_BAND )); then
  log "coastline low band: source=land_polygons simplify_meters=$LOW_SIMPLIFY_METERS min_closed_feature_length_meters=$LOW_MIN_CLOSED_FEATURE_LENGTH_METERS min_area_km2=$LOW_MIN_AREA_KM2 merge_distance_meters=$LOW_MERGE_DISTANCE_METERS minzoom=$LOW_MINZOOM maxzoom=$LOW_MAXZOOM basezoom=$LOW_BASEZOOM"
fi
if (( BUILD_MID_BAND )); then
  log "coastline mid band: source=land_polygons simplify_meters=$MID_SIMPLIFY_METERS min_closed_feature_length_meters=$MID_MIN_CLOSED_FEATURE_LENGTH_METERS min_area_km2=$MID_MIN_AREA_KM2 merge_distance_meters=$MID_MERGE_DISTANCE_METERS minzoom=$MID_MINZOOM maxzoom=$MID_MAXZOOM basezoom=$MID_BASEZOOM"
fi
if (( BUILD_HIGH_BAND )); then
  log "coastline high band: source=lines simplify_meters=$HIGH_SIMPLIFY_METERS min_closed_feature_length_meters=$HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS minzoom=$HIGH_MINZOOM maxzoom=$HIGH_MAXZOOM basezoom=$HIGH_BASEZOOM"
fi
log "tippecanoe settings: tile_buffer=$TILE_BUFFER"
run "${cmd[@]}"
log "Assembled coastline database ready: $OUTPUT_DATABASE"

if (( ! OUTPUT_LINES )); then
  log "Skipping MBTiles build because --no-output-lines was requested"
  exit 0
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-osmcoastline.XXXXXX")"
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
MID_SEQ="$WORKDIR/coastline-mid.geojsonseq"
MID_MBTILES="$WORKDIR/coastline-mid.mbtiles"
HIGH_SEQ="$WORKDIR/coastline-high.geojsonseq"
HIGH_MBTILES="$WORKDIR/coastline-high.mbtiles"
BUILT_BANDS=()

if (( BUILD_LOW_BAND )); then
  LOW_SQL="$(build_polygon_boundary_export_sql "$LOW_SIMPLIFY_METERS" "$LOW_MIN_CLOSED_FEATURE_LENGTH_METERS" "$LOW_MIN_AREA_KM2" "$LOW_MERGE_DISTANCE_METERS")"
  export_coastline_lines "$LOW_SEQ" "$LOW_SQL"
  if seq_has_features "$LOW_SEQ"; then
    build_coastline_mbtiles "$LOW_SEQ" "$LOW_MBTILES" "$LOW_MINZOOM" "$LOW_MAXZOOM" "$LOW_BASEZOOM"
    BUILT_BANDS+=("$LOW_MBTILES")
  else
    log "Coastline low band produced no features; skipping"
  fi
fi

if (( BUILD_MID_BAND )); then
  MID_SQL="$(build_polygon_boundary_export_sql "$MID_SIMPLIFY_METERS" "$MID_MIN_CLOSED_FEATURE_LENGTH_METERS" "$MID_MIN_AREA_KM2" "$MID_MERGE_DISTANCE_METERS")"
  export_coastline_lines "$MID_SEQ" "$MID_SQL"
  if seq_has_features "$MID_SEQ"; then
    build_coastline_mbtiles "$MID_SEQ" "$MID_MBTILES" "$MID_MINZOOM" "$MID_MAXZOOM" "$MID_BASEZOOM"
    BUILT_BANDS+=("$MID_MBTILES")
  else
    log "Coastline mid band produced no features; skipping"
  fi
fi

if (( BUILD_HIGH_BAND )); then
  HIGH_SQL="$(build_line_export_sql "$HIGH_SIMPLIFY_METERS" "$HIGH_MIN_CLOSED_FEATURE_LENGTH_METERS")"
  export_coastline_lines "$HIGH_SEQ" "$HIGH_SQL"
  if seq_has_features "$HIGH_SEQ"; then
    build_coastline_mbtiles "$HIGH_SEQ" "$HIGH_MBTILES" "$HIGH_MINZOOM" "$HIGH_MAXZOOM" "$HIGH_BASEZOOM"
    BUILT_BANDS+=("$HIGH_MBTILES")
  else
    log "Coastline high band produced no features; skipping"
  fi
fi

if [[ ${#BUILT_BANDS[@]} -eq 0 ]]; then
  log "Coastline build produced no features for any zoom band; skipping output"
  exit 0
elif [[ ${#BUILT_BANDS[@]} -eq 1 ]]; then
  mkdir -p "$(dirname "$OUTPUT_MBTILES")"
  rm -f "$OUTPUT_MBTILES"
  run cp "${BUILT_BANDS[0]}" "$OUTPUT_MBTILES"
  metadata_upsert "$OUTPUT_MBTILES" "name" "$TILESET_NAME"
  metadata_upsert "$OUTPUT_MBTILES" "description" "$TILESET_DESCRIPTION"
  metadata_upsert "$OUTPUT_MBTILES" "type" "overlay"
  metadata_upsert "$OUTPUT_MBTILES" "version" "$VERSION"
else
  merge_coastline_mbtiles "$OUTPUT_MBTILES" "${BUILT_BANDS[@]}"
fi

log "Coastline MBTiles ready: $OUTPUT_MBTILES"
