#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

# Fast iteration default. Switch to ${DATA_DIR}/planet-260406.osm.pbf for full-world builds.
OSM_INPUT="${DATA_DIR}/iteration.osm.pbf"
COASTLINE_INPUT="${DATA_DIR}/coastline.mbtiles"
OUTPUT_MBTILES="${STATIC_DIR}/basemap-raster.mbtiles"

# Keep this bounded for smoke tests. Set to "" for a full-world render.
# Gulf-wide enough to include Louisiana, east Texas, and a strip of northern Mexico.
BBOX="-100.5,22.5,-87.0,33.8"
MAXZOOM="6"
MINZOOM="0"

# Louisiana won't show admin_level=2; switch to 4 locally if you want to see borders while iterating there.
BOUNDARY_ADMIN_LEVEL="2"

# Render slightly above the target tile resolution so low-zoom lines stay visible.
RASTER_OVERSAMPLE="2"
COASTLINE_BUFFER_METERS="5000"
BOUNDARY_BUFFER_METERS="3000"

BACKGROUND_COLOR_R="195"
BACKGROUND_COLOR_G="212"
BACKGROUND_COLOR_B="228"
LINE_COLOR_R="55"
LINE_COLOR_G="73"
LINE_COLOR_B="92"

KEEP_WORKDIR=0
COASTLINE_LAYER="coastline"
WORLD_EXTENT_3857="-20037508.342789244 -20037508.342789244 20037508.342789244 20037508.342789244"

validate_byte() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[0-9]+$ ]] || die "Invalid ${name} value: $value"
  (( value >= 0 && value <= 255 )) || die "${name} must be between 0 and 255: $value"
}

validate_positive_number() {
  local name="$1"
  local value="$2"

  [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "Invalid ${name} value: $value"
}

project_bbox_to_3857() {
  if [[ -z "$BBOX" ]]; then
    printf '%s\n' "$WORLD_EXTENT_3857"
    return
  fi

  python3 - "$BBOX" <<'PY'
import sys
from osgeo import osr

minlon, minlat, maxlon, maxlat = [float(value) for value in sys.argv[1].split(",")]

src = osr.SpatialReference()
src.ImportFromEPSG(4326)
src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

dst = osr.SpatialReference()
dst.ImportFromEPSG(3857)
dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

transform = osr.CoordinateTransformation(src, dst)
points = [
    transform.TransformPoint(minlon, minlat),
    transform.TransformPoint(minlon, maxlat),
    transform.TransformPoint(maxlon, minlat),
    transform.TransformPoint(maxlon, maxlat),
]

xs = [point[0] for point in points]
ys = [point[1] for point in points]
print(f"{min(xs)} {min(ys)} {max(xs)} {max(ys)}")
PY
}

maxzoom_pixel_size_meters() {
  awk -v maxzoom="$MAXZOOM" -v oversample="$RASTER_OVERSAMPLE" '
    BEGIN {
      printf "%.12f\n", 156543.03392804097 / (2 ^ maxzoom) / oversample
    }
  '
}

canvas_dimensions() {
  local minx="$1"
  local miny="$2"
  local maxx="$3"
  local maxy="$4"
  local pixel_size="$5"

  awk -v minx="$minx" -v miny="$miny" -v maxx="$maxx" -v maxy="$maxy" -v pixel="$pixel_size" '
    BEGIN {
      width = int(((maxx - minx) / pixel) + 0.999999)
      height = int(((maxy - miny) / pixel) + 0.999999)
      if (width < 1) width = 1
      if (height < 1) height = 1
      printf "%d %d\n", width, height
    }
  '
}

create_byte_canvas() {
  local output_tif="$1"
  local minx="$2"
  local miny="$3"
  local maxx="$4"
  local maxy="$5"
  local pixel_size="$6"
  local width height

  read -r width height < <(canvas_dimensions "$minx" "$miny" "$maxx" "$maxy" "$pixel_size")

  run gdal_create \
    -of GTiff \
    -outsize "$width" "$height" \
    -bands 1 \
    -ot Byte \
    -burn 0 \
    -a_srs EPSG:3857 \
    -a_ullr "$minx" "$maxy" "$maxx" "$miny" \
    -a_nodata 0 \
    -co TILED=YES \
    -co COMPRESS=DEFLATE \
    "$output_tif"
}

build_input_subset() {
  local source_pbf="$OSM_INPUT"
  local extracted="$WORKDIR/extracted.osm.pbf"
  local filtered="$WORKDIR/boundaries.osm.pbf"

  if [[ -n "$BBOX" ]]; then
    log "Extracting geographic subset"
    run osmium extract \
      --bbox "$BBOX" \
      --strategy complete_ways \
      --set-bounds \
      -O \
      -o "$extracted" \
      "$OSM_INPUT"
    source_pbf="$extracted"
  fi

  log "Filtering OSM data to administrative boundary ways"
  run osmium tags-filter \
    -O \
    -o "$filtered" \
    "$source_pbf" \
    w/boundary=administrative

  printf '%s\n' "$filtered"
}

extract_boundary_vector() {
  local filtered_pbf="$1"
  local boundaries_gpkg="$WORKDIR/boundaries.gpkg"
  local sql="
SELECT
  geometry
FROM lines
WHERE hstore_get_value(other_tags, 'boundary') = 'administrative'
  AND hstore_get_value(other_tags, 'admin_level') = '${BOUNDARY_ADMIN_LEVEL}'
  AND COALESCE(hstore_get_value(other_tags, 'maritime'), '') NOT IN ('yes', 'true', '1')
"
  local -a cmd=(
    ogr2ogr
    -overwrite
    -f GPKG
    "$boundaries_gpkg"
    "$filtered_pbf"
    lines
    -dialect sqlite
    -sql "$sql"
    -s_srs EPSG:4326
    -t_srs EPSG:3857
    -nln boundaries
    -lco GEOMETRY_NAME=geometry
    -skipfailures
  )

  if [[ -n "$BBOX" ]]; then
    local minlon minlat maxlon maxlat
    IFS=',' read -r minlon minlat maxlon maxlat <<<"$BBOX"
    cmd+=( -clipsrc "$minlon" "$minlat" "$maxlon" "$maxlat" )
  fi

  log "Extracting admin_level=${BOUNDARY_ADMIN_LEVEL} boundary geometry"
  run "${cmd[@]}"

  printf '%s\n' "$boundaries_gpkg"
}

extract_coastline_vector() {
  local coastline_gpkg="$WORKDIR/coastline.gpkg"
  local -a cmd=(
    ogr2ogr
    -overwrite
    -f GPKG
    "$coastline_gpkg"
    "$COASTLINE_INPUT"
    -dialect SQLITE
    -sql "SELECT geometry FROM ${COASTLINE_LAYER}"
    -nln coastline
    -nlt MULTILINESTRING
    -lco GEOMETRY_NAME=geometry
    -skipfailures
  )

  if [[ -n "$BBOX" ]]; then
    local minx miny maxx maxy
    read -r minx miny maxx maxy < <(project_bbox_to_3857)
    cmd+=( -clipsrc "$minx" "$miny" "$maxx" "$maxy" )
  fi

  log "Extracting coastline geometry"
  run "${cmd[@]}"

  printf '%s\n' "$coastline_gpkg"
}

gpkg_feature_count() {
  local gpkg="$1"
  local layer="$2"
  local exists

  exists="$(sqlite3 "$gpkg" "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '$layer';")"
  if [[ "$exists" != "1" ]]; then
    printf '0\n'
    return
  fi

  sqlite3 "$gpkg" "SELECT COUNT(*) FROM \"$layer\";"
}

rasterize_buffered_layer() {
  local vector_path="$1"
  local layer_name="$2"
  local buffer_meters="$3"
  local output_tif="$4"
  local count
  local sql

  count="$(gpkg_feature_count "$vector_path" "$layer_name")"
  if [[ "$count" == "0" ]]; then
    log "Skipping ${layer_name}: no features in requested extent"
    return
  fi

  if [[ "$buffer_meters" == "0" ]]; then
    sql="SELECT geometry FROM ${layer_name}"
  else
    sql="SELECT ST_Buffer(geometry, ${buffer_meters}) AS geometry FROM ${layer_name}"
  fi

  log "Rasterizing ${layer_name} (${count} features)"
  run gdal_rasterize \
    -burn 255 \
    -dialect SQLITE \
    -sql "$sql" \
    "$vector_path" \
    "$output_tif"
}

build_color_band() {
  local mask_tif="$1"
  local background="$2"
  local line="$3"
  local output_tif="$4"

  run gdal_calc.py \
    -A "$mask_tif" \
    --calc="where(A>0, ${line}, ${background})" \
    --type=Byte \
    --NoDataValue=0 \
    --outfile="$output_tif" \
    --overwrite
}

build_alpha_band() {
  local mask_tif="$1"
  local output_tif="$2"

  run gdal_calc.py \
    -A "$mask_tif" \
    --calc="A*0+255" \
    --type=Byte \
    --NoDataValue=0 \
    --outfile="$output_tif" \
    --overwrite
}

compose_rgba_raster() {
  local mask_tif="$1"
  local rgba_tif="$WORKDIR/basemap-rgba.tif"
  local r_tif="$WORKDIR/basemap-r.tif"
  local g_tif="$WORKDIR/basemap-g.tif"
  local b_tif="$WORKDIR/basemap-b.tif"
  local a_tif="$WORKDIR/basemap-a.tif"

  log "Composing flat-color basemap raster"
  build_color_band "$mask_tif" "$BACKGROUND_COLOR_R" "$LINE_COLOR_R" "$r_tif"
  build_color_band "$mask_tif" "$BACKGROUND_COLOR_G" "$LINE_COLOR_G" "$g_tif"
  build_color_band "$mask_tif" "$BACKGROUND_COLOR_B" "$LINE_COLOR_B" "$b_tif"
  build_alpha_band "$mask_tif" "$a_tif"

  run gdal_merge.py \
    -separate \
    -o "$rgba_tif" \
    "$r_tif" \
    "$g_tif" \
    "$b_tif" \
    "$a_tif"

  printf '%s\n' "$rgba_tif"
}

build_mbtiles() {
  local input_raster="$1"

  mkdir -p "$(dirname "$OUTPUT_MBTILES")"
  rm -f "$OUTPUT_MBTILES"

  log "Translating raster to MBTiles: $(basename "$OUTPUT_MBTILES")"
  run gdal_translate \
    -of MBTILES \
    -co NAME=weather-basemap-raster \
    -co DESCRIPTION="Flat raster basemap prototype with coastlines and admin boundaries" \
    -co TYPE=baselayer \
    -co TILE_FORMAT=PNG \
    "$input_raster" \
    "$OUTPUT_MBTILES"

  run gdaladdo \
    -r average \
    "$OUTPUT_MBTILES" \
    2 4 8 16

  metadata_upsert "$OUTPUT_MBTILES" "minzoom" "$MINZOOM"
  metadata_upsert "$OUTPUT_MBTILES" "maxzoom" "$MAXZOOM"
  metadata_upsert "$OUTPUT_MBTILES" "version" "$VERSION"
}

require_cmd awk
require_cmd gdal_create
require_cmd gdal_translate
require_cmd gdaladdo
require_cmd gdal_calc.py
require_cmd gdal_merge.py
require_cmd gdal_rasterize
require_cmd ogr2ogr
require_cmd osmium
require_cmd python3
require_cmd sqlite3

require_file "$OSM_INPUT"
require_file "$COASTLINE_INPUT"
ensure_vector_layer "$COASTLINE_INPUT" "$COASTLINE_LAYER"

validate_zoom_arg "MAXZOOM" "$MAXZOOM"
validate_zoom_arg "MINZOOM" "$MINZOOM"
(( MINZOOM <= MAXZOOM )) || die "MINZOOM must be less than or equal to MAXZOOM"
[[ "$BOUNDARY_ADMIN_LEVEL" =~ ^[0-9]+$ ]] || die "Invalid BOUNDARY_ADMIN_LEVEL: $BOUNDARY_ADMIN_LEVEL"
validate_positive_number "RASTER_OVERSAMPLE" "$RASTER_OVERSAMPLE"
validate_positive_number "COASTLINE_BUFFER_METERS" "$COASTLINE_BUFFER_METERS"
validate_positive_number "BOUNDARY_BUFFER_METERS" "$BOUNDARY_BUFFER_METERS"
validate_byte "BACKGROUND_COLOR_R" "$BACKGROUND_COLOR_R"
validate_byte "BACKGROUND_COLOR_G" "$BACKGROUND_COLOR_G"
validate_byte "BACKGROUND_COLOR_B" "$BACKGROUND_COLOR_B"
validate_byte "LINE_COLOR_R" "$LINE_COLOR_R"
validate_byte "LINE_COLOR_G" "$LINE_COLOR_G"
validate_byte "LINE_COLOR_B" "$LINE_COLOR_B"
if [[ -n "$BBOX" ]]; then
  validate_bbox "$BBOX"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-basemap-raster.XXXXXX")"
cleanup() {
  if (( KEEP_WORKDIR )); then
    log "Keeping workdir: $WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

log "Using OSM input: $OSM_INPUT"
log "Using coastline input: $COASTLINE_INPUT"
log "Output raster MBTiles: $OUTPUT_MBTILES"
log "BBOX: ${BBOX:-<world>}"
log "Max zoom: $MAXZOOM"
log "Boundary admin level: $BOUNDARY_ADMIN_LEVEL"

PIXEL_SIZE_METERS="$(maxzoom_pixel_size_meters)"
log "Pixel size meters: $PIXEL_SIZE_METERS"

read -r MINX MINY MAXX MAXY < <(project_bbox_to_3857)
MASK_TIF="$WORKDIR/line-mask.tif"
create_byte_canvas "$MASK_TIF" "$MINX" "$MINY" "$MAXX" "$MAXY" "$PIXEL_SIZE_METERS"

FILTERED_PBF="$(build_input_subset)"
BOUNDARIES_GPKG="$(extract_boundary_vector "$FILTERED_PBF")"
COASTLINE_GPKG="$(extract_coastline_vector)"

rasterize_buffered_layer "$COASTLINE_GPKG" "coastline" "$COASTLINE_BUFFER_METERS" "$MASK_TIF"
rasterize_buffered_layer "$BOUNDARIES_GPKG" "boundaries" "$BOUNDARY_BUFFER_METERS" "$MASK_TIF"

RGBA_TIF="$(compose_rgba_raster "$MASK_TIF")"
build_mbtiles "$RGBA_TIF"

log "Basemap raster ready: $OUTPUT_MBTILES"
