#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

OSM_INPUT=""
BBOX=""
COASTAL_RELIEF_OUTPUT="${STATIC_DIR}/coastal-relief.mbtiles"
MINZOOM="0"
MAXZOOM="6"
PIXEL_SIZE_METERS="250"
COASTAL_MAXDIST_METERS="12000"
COASTAL_CORE_METERS="600"
COASTAL_MAX_ALPHA="220"
COASTAL_COLOR_R="34"
COASTAL_COLOR_G="47"
COASTAL_COLOR_B="62"
OFFSHORE_SEED_METERS=""
KEEP_WORKDIR=0

usage() {
  cat <<EOF
Build an offshore coastal relief raster overlay for MapLibre from OSM coastline data.

Usage:
  $(basename "$0") --osm-input PATH --bbox minlon,minlat,maxlon,maxlat [options]

Options:
  --osm-input PATH             Input OSM PBF (planet extract, regional extract, or iteration.osm.pbf) [required]
  --bbox minlon,minlat,maxlon,maxlat
                               Required build extent in EPSG:4326
  --coastal-output PATH        Output coastal relief MBTiles
  --minzoom N                  Minimum zoom for raster MBTiles (default: ${MINZOOM})
  --maxzoom N                  Maximum zoom for raster MBTiles (default: ${MAXZOOM})
  --pixel-size-meters N        Intermediate raster resolution in meters (default: ${PIXEL_SIZE_METERS})
  --coastal-maxdist-meters N   Relief falloff distance from coastline (default: ${COASTAL_MAXDIST_METERS})
  --coastal-core-meters N      Fully opaque band right at the coastline (default: ${COASTAL_CORE_METERS})
  --coastal-max-alpha N        Peak alpha 0-255 for coastal relief (default: ${COASTAL_MAX_ALPHA})
  --coastal-color R,G,B        Relief tint color (default: ${COASTAL_COLOR_R},${COASTAL_COLOR_G},${COASTAL_COLOR_B})
  --offshore-seed-meters N     Seed distance on the water side of each coastline segment
                               (default: auto=max(2*pixel-size, coastal-core))
  --keep-workdir               Keep temporary files in /tmp
  --help                       Show this message

Notes:
  * Offshore masking is inferred from coastline geometry by seeding both sides of the coastline and
    choosing the more open connected component inside the requested bbox.
  * iteration.osm.pbf now needs coastline ways present; build-iteration-pbf.sh includes them by default.
  * The script intentionally requires --bbox so the working raster stays bounded and practical.
EOF
}

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

parse_color() {
  local spec="$1"
  IFS=',' read -r COASTAL_COLOR_R COASTAL_COLOR_G COASTAL_COLOR_B <<<"$spec"
  validate_byte "--coastal-color R" "$COASTAL_COLOR_R"
  validate_byte "--coastal-color G" "$COASTAL_COLOR_G"
  validate_byte "--coastal-color B" "$COASTAL_COLOR_B"
}

project_bbox_to_3857() {
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

build_coastline_vector() {
  local source_pbf="$OSM_INPUT"
  local extracted="$WORKDIR/extracted.osm.pbf"
  local coast_pbf="$WORKDIR/coastline.osm.pbf"
  local coast_vector="$WORKDIR/coastline.gpkg"
  local minlon minlat maxlon maxlat

  IFS=',' read -r minlon minlat maxlon maxlat <<<"$BBOX"

  log "Extracting geographic subset"
  run osmium extract \
    --bbox "$BBOX" \
    --strategy complete_ways \
    --set-bounds \
    -O \
    -o "$extracted" \
    "$OSM_INPUT"
  source_pbf="$extracted"

  log "Filtering OSM data to coastline ways"
  run osmium tags-filter \
    -O \
    -o "$coast_pbf" \
    "$source_pbf" \
    w/natural=coastline

  log "Extracting coastline geometries"
  run ogr2ogr \
    -f GPKG \
    "$coast_vector" \
    "$coast_pbf" \
    lines \
    -clipsrc "$minlon" "$minlat" "$maxlon" "$maxlat" \
    -s_srs EPSG:4326 \
    -t_srs EPSG:3857 \
    -nln coastline \
    -skipfailures

  printf '%s\n' "$coast_vector"
}

build_coast_mask() {
  local coast_vector="$1"
  local coast_mask="$WORKDIR/coast-mask.tif"
  local minx miny maxx maxy

  read -r minx miny maxx maxy < <(project_bbox_to_3857)

  log "Rasterizing coastline mask"
  run gdal_rasterize \
    -burn 255 \
    -at \
    -a_srs EPSG:3857 \
    -ot Byte \
    -init 0 \
    -a_nodata 0 \
    -tr "$PIXEL_SIZE_METERS" "$PIXEL_SIZE_METERS" \
    -tap \
    -te "$minx" "$miny" "$maxx" "$maxy" \
    -l coastline \
    "$coast_vector" \
    "$coast_mask"

  printf '%s\n' "$coast_mask"
}

build_coast_distance() {
  local coast_mask="$1"
  local coast_distance="$WORKDIR/coast-distance.tif"

  log "Computing coastline distance field"
  run gdal_proximity.py \
    "$coast_mask" \
    "$coast_distance" \
    -values 255 \
    -distunits GEO \
    -maxdist "$COASTAL_MAXDIST_METERS" \
    -nodata "$COASTAL_MAXDIST_METERS"

  printf '%s\n' "$coast_distance"
}

build_offshore_mask() {
  local coast_vector="$1"
  local coast_mask="$2"
  local offshore_mask="$WORKDIR/offshore-mask.tif"

  log "Inferring offshore mask from coastline geometry"
  python3 - "$coast_vector" "$coast_mask" "$offshore_mask" "$OFFSHORE_SEED_METERS" <<'PY' || return 1
from collections import deque
import math
import sys

from osgeo import gdal, ogr
import numpy as np

coastline_path, coast_mask_path, out_path, seed_distance = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])

coast_ds = gdal.Open(coast_mask_path)
vector_ds = ogr.Open(coastline_path)
if coast_ds is None or vector_ds is None:
    raise SystemExit("Failed to open coastline mask or coastline vectors")

barrier = coast_ds.GetRasterBand(1).ReadAsArray() > 0
rows, cols = barrier.shape
layer = vector_ds.GetLayer(0)
gt = coast_ds.GetGeoTransform()
origin_x, pixel_w, _, origin_y, _, pixel_h = gt

if pixel_w == 0 or pixel_h == 0:
    raise SystemExit("Invalid coastline raster geotransform")

def world_to_rc(x, y):
    col = int((x - origin_x) / pixel_w)
    row = int((y - origin_y) / pixel_h)
    return row, col

def maybe_seed(seed_mask, x, y):
    row, col = world_to_rc(x, y)
    if row < 0 or row >= rows or col < 0 or col >= cols:
        return False
    if barrier[row, col]:
        return False
    seed_mask[row, col] = 1
    return True

def iter_lines(geometry):
    geom_type = ogr.GT_Flatten(geometry.GetGeometryType())
    if geom_type == ogr.wkbLineString:
        yield geometry
        return

    for index in range(geometry.GetGeometryCount()):
        child = geometry.GetGeometryRef(index)
        if child is not None:
            yield from iter_lines(child)

left_seed_mask = np.zeros((rows, cols), dtype=np.uint8)
right_seed_mask = np.zeros((rows, cols), dtype=np.uint8)
left_seed_count = 0
right_seed_count = 0
for feature in layer:
    geometry = feature.GetGeometryRef()
    if geometry is None:
        continue

    for line in iter_lines(geometry):
        points = line.GetPoints()
        if len(points) < 2:
            continue

        for start, end in zip(points, points[1:]):
            x1, y1 = start[:2]
            x2, y2 = end[:2]
            dx = x2 - x1
            dy = y2 - y1
            length = math.hypot(dx, dy)
            if length == 0:
                continue

            mid_x = (x1 + x2) / 2.0
            mid_y = (y1 + y2) / 2.0
            left_x = -dy / length
            left_y = dx / length
            right_x = dy / length
            right_y = -dx / length

            for multiplier in (1.0, 2.0, 4.0, 8.0, 16.0, 32.0):
                seed_x = mid_x + right_x * seed_distance * multiplier
                seed_y = mid_y + right_y * seed_distance * multiplier
                if maybe_seed(right_seed_mask, seed_x, seed_y):
                    right_seed_count += 1
                    break

            for multiplier in (1.0, 2.0, 4.0, 8.0, 16.0, 32.0):
                seed_x = mid_x + left_x * seed_distance * multiplier
                seed_y = mid_y + left_y * seed_distance * multiplier
                if maybe_seed(left_seed_mask, seed_x, seed_y):
                    left_seed_count += 1
                    break

if left_seed_count == 0 and right_seed_count == 0:
    raise SystemExit("Failed to seed pixels from coastline geometry. Check that the input PBF contains natural=coastline within the bbox.")

neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

def flood_fill(seed_mask):
    visited = seed_mask.copy()
    queue = deque((row, col) for row, col in zip(*np.where(visited > 0)))

    while queue:
        row, col = queue.popleft()
        for drow, dcol in neighbors:
            next_row = row + drow
            next_col = col + dcol
            if next_row < 0 or next_row >= rows or next_col < 0 or next_col >= cols:
                continue
            if visited[next_row, next_col] or barrier[next_row, next_col]:
                continue
            visited[next_row, next_col] = 1
            queue.append((next_row, next_col))

    return visited

def score(mask):
    if mask.size == 0:
        return (0, 0)

    border = (
        int(mask[0, :].sum())
        + int(mask[-1, :].sum())
        + int(mask[:, 0].sum())
        + int(mask[:, -1].sum())
    )
    area = int(mask.sum())
    return (border, area)

left_visited = flood_fill(left_seed_mask) if left_seed_count > 0 else np.zeros((rows, cols), dtype=np.uint8)
right_visited = flood_fill(right_seed_mask) if right_seed_count > 0 else np.zeros((rows, cols), dtype=np.uint8)

left_score = score(left_visited)
right_score = score(right_visited)
visited = right_visited if right_score > left_score else left_visited

driver = gdal.GetDriverByName("GTiff")
out_ds = driver.Create(
    out_path,
    cols,
    rows,
    1,
    gdal.GDT_Byte,
    options=["TILED=YES", "COMPRESS=DEFLATE"],
)
out_ds.SetGeoTransform(coast_ds.GetGeoTransform())
out_ds.SetProjection(coast_ds.GetProjection())
out_band = out_ds.GetRasterBand(1)
out_band.WriteArray(visited * 255)
out_band.SetNoDataValue(0)
out_band.FlushCache()
out_ds = None
PY

  printf '%s\n' "$offshore_mask"
}

build_coastal_alpha() {
  local coast_distance="$1"
  local offshore_mask="$2"
  local alpha_raw_tif="$WORKDIR/coastal-alpha-raw.tif"
  local alpha_tif="$WORKDIR/coastal-alpha.tif"
  local fade_span
  local formula

  fade_span="$(
    awk -v maxdist="$COASTAL_MAXDIST_METERS" -v core="$COASTAL_CORE_METERS" '
      BEGIN {
        span = maxdist - core
        if (span < 1) {
          span = 1
        }
        printf "%.6f\n", span
      }
    '
  )"
  formula="where(A<=${COASTAL_CORE_METERS}, ${COASTAL_MAX_ALPHA}, where(A>=${COASTAL_MAXDIST_METERS}, 0, ((${COASTAL_MAXDIST_METERS}-A)*${COASTAL_MAX_ALPHA}/${fade_span})))"

  log "Building coastal alpha ramp"
  run gdal_calc.py \
    -A "$coast_distance" \
    --calc="$formula" \
    --type=Byte \
    --NoDataValue=0 \
    --outfile="$alpha_raw_tif" \
    --overwrite

  log "Masking coastal alpha to offshore pixels"
  run gdal_calc.py \
    -A "$alpha_raw_tif" \
    -B "$offshore_mask" \
    --calc="where(B>0, A, 0)" \
    --type=Byte \
    --NoDataValue=0 \
    --outfile="$alpha_tif" \
    --overwrite

  printf '%s\n' "$alpha_tif"
}

build_constant_band() {
  local alpha_tif="$1"
  local value="$2"
  local output_tif="$3"

  run gdal_calc.py \
    -A "$alpha_tif" \
    --calc="A*0+${value}" \
    --type=Byte \
    --NoDataValue=0 \
    --outfile="$output_tif" \
    --overwrite
}

build_coastal_rgba() {
  local alpha_tif="$1"
  local r_tif="$WORKDIR/coastal-r.tif"
  local g_tif="$WORKDIR/coastal-g.tif"
  local b_tif="$WORKDIR/coastal-b.tif"
  local rgba_tif="$WORKDIR/coastal-rgba.tif"

  log "Composing RGBA coastal relief raster"
  build_constant_band "$alpha_tif" "$COASTAL_COLOR_R" "$r_tif"
  build_constant_band "$alpha_tif" "$COASTAL_COLOR_G" "$g_tif"
  build_constant_band "$alpha_tif" "$COASTAL_COLOR_B" "$b_tif"

  run gdal_merge.py \
    -separate \
    -o "$rgba_tif" \
    "$r_tif" \
    "$g_tif" \
    "$b_tif" \
    "$alpha_tif"

  printf '%s\n' "$rgba_tif"
}

build_mbtiles() {
  local input_raster="$1"
  local output_mbtiles="$2"
  local name="$3"
  local description="$4"

  mkdir -p "$(dirname "$output_mbtiles")"
  rm -f "$output_mbtiles"

  log "Translating raster to MBTiles: $(basename "$output_mbtiles")"
  run gdal_translate \
    -of MBTILES \
    -co NAME="$name" \
    -co DESCRIPTION="$description" \
    -co TYPE=overlay \
    -co TILE_FORMAT=PNG \
    "$input_raster" \
    "$output_mbtiles"

  run gdaladdo \
    -r average \
    "$output_mbtiles" \
    2 4 8 16

  metadata_upsert "$output_mbtiles" "minzoom" "$MINZOOM"
  metadata_upsert "$output_mbtiles" "maxzoom" "$MAXZOOM"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --osm-input)
      OSM_INPUT="$2"
      shift 2
      ;;
    --bbox)
      BBOX="$2"
      shift 2
      ;;
    --coastal-output)
      COASTAL_RELIEF_OUTPUT="$2"
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
    --pixel-size-meters)
      PIXEL_SIZE_METERS="$2"
      shift 2
      ;;
    --coastal-maxdist-meters)
      COASTAL_MAXDIST_METERS="$2"
      shift 2
      ;;
    --coastal-core-meters)
      COASTAL_CORE_METERS="$2"
      shift 2
      ;;
    --coastal-max-alpha)
      COASTAL_MAX_ALPHA="$2"
      shift 2
      ;;
    --coastal-color)
      parse_color "$2"
      shift 2
      ;;
    --offshore-seed-meters)
      OFFSHORE_SEED_METERS="$2"
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
require_cmd gdal_translate
require_cmd gdaladdo
require_cmd gdal_calc.py
require_cmd gdal_merge.py
require_cmd gdal_rasterize
require_cmd gdal_proximity.py
require_cmd ogr2ogr
require_cmd osmium
require_cmd python3
require_cmd sqlite3

[[ -n "$OSM_INPUT" ]] || die "--osm-input is required"
[[ -n "$BBOX" ]] || die "--bbox is required"
require_file "$OSM_INPUT"
validate_bbox "$BBOX"

validate_zoom_arg "--minzoom" "$MINZOOM"
validate_zoom_arg "--maxzoom" "$MAXZOOM"
(( MINZOOM <= MAXZOOM )) || die "--minzoom must be less than or equal to --maxzoom"
validate_positive_number "--pixel-size-meters" "$PIXEL_SIZE_METERS"
validate_positive_number "--coastal-maxdist-meters" "$COASTAL_MAXDIST_METERS"
validate_positive_number "--coastal-core-meters" "$COASTAL_CORE_METERS"
validate_byte "--coastal-max-alpha" "$COASTAL_MAX_ALPHA"

if [[ -n "$OFFSHORE_SEED_METERS" ]]; then
  validate_positive_number "--offshore-seed-meters" "$OFFSHORE_SEED_METERS"
else
  OFFSHORE_SEED_METERS="$(
    awk -v pixel_size="$PIXEL_SIZE_METERS" -v coastal_core="$COASTAL_CORE_METERS" '
      BEGIN {
        seed = pixel_size * 2
        if (coastal_core > seed) {
          seed = coastal_core
        }
        printf "%.3f\n", seed
      }
    '
  )"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/weather-map-relief.XXXXXX")"
cleanup() {
  if (( KEEP_WORKDIR )); then
    log "Keeping workdir: $WORKDIR"
  else
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT

log "Using OSM input: $OSM_INPUT"
log "BBOX: $BBOX"
log "Pixel size meters: $PIXEL_SIZE_METERS"
log "Offshore seed meters: $OFFSHORE_SEED_METERS"
log "Coastal relief output: $COASTAL_RELIEF_OUTPUT"

COASTLINE_VECTOR="$(build_coastline_vector)"
if [[ ! -f "$COASTLINE_VECTOR" ]]; then
  log "No coastline geometries found inside the requested bbox; skipping coastal relief build"
  rm -f "$COASTAL_RELIEF_OUTPUT"
  exit 0
fi

COAST_MASK="$(build_coast_mask "$COASTLINE_VECTOR")"
COAST_DISTANCE="$(build_coast_distance "$COAST_MASK")"
OFFSHORE_MASK="$(build_offshore_mask "$COASTLINE_VECTOR" "$COAST_MASK")"
COAST_ALPHA="$(build_coastal_alpha "$COAST_DISTANCE" "$OFFSHORE_MASK")"
COAST_RGBA="$(build_coastal_rgba "$COAST_ALPHA")"

build_mbtiles "$COAST_RGBA" "$COASTAL_RELIEF_OUTPUT" "coastal-relief" "Distance-based coastal relief overlay"

log "Coastal relief raster ready"
