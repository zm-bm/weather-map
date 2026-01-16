import argparse
import json
import shutil
import subprocess
from pathlib import Path

import boto3

LAYER_CFG = {
  "temp2m": {
        "grib_match": {
            "GRIB_ELEMENT": "TMP",
            "GRIB_SHORT_NAME": "2-HTGL",
        },
        "scale_min": -45,
        "scale_max": 50,
        "units": "C",
        "colortable": [
            [ 50,    61,   2,  22],
            [ 47.5,  86,  12,  37],
            [ 44.7, 110,  21,  49],
            [ 41.9, 135,  32,  62],
            [ 39.2, 159,  41,  76],
            [ 36.4, 175,  77,  76],
            [ 33.6, 190, 112,  76],
            [ 30.8, 195, 138,  83],
            [ 28.1, 193, 157,  97],
            [ 25.3, 194, 171, 117],
            [ 22.5, 171, 168, 125],
            [ 19.7, 135, 154, 132],
            [ 16.9, 100, 141, 137],
            [ 14.2,  67, 129, 144],
            [ 11.4,  40, 117, 147],
            [  8.6,  39, 103, 138],
            [  5.8,  38,  92, 130],
            [  3.1,  37,  79, 119],
            [  0.3,  38,  67, 111],
            [ -2.5,  47,  71, 117],
            [ -5.3,  57,  81, 127],
            [ -8.1,  65,  92, 135],
            [-10.8,  77, 101, 145],
            [-13.6,  86, 113, 156],
            [-16.4,  96, 123, 166],
            [-19.2, 117, 145, 185],
            [-21.9, 127, 155, 195],
            [-24.7, 138, 164, 205],
            [-27.5, 147, 177, 215],
            [-30.3, 156, 184, 223],
            [-33.1, 167, 191, 227],
            [-35.8, 175, 198, 230],
            [-38.6, 184, 205, 234],
            [-41.4, 192, 212, 237],
            [-45.0, 203, 219, 244],
        ],
    },
}

def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd)


def run_capture(cmd: list[str]) -> str:
    print("+", " ".join(cmd), flush=True)
    return subprocess.check_output(cmd, text=True)


def band_metadata(grib_path: Path) -> list[dict[str, str]]:
    out = run_capture(["gdalinfo", "-json", str(grib_path)])
    info = json.loads(out)
    bands = info.get("bands", [])
    metas: list[dict[str, str]] = []
    for band in bands:
        md = band.get("metadata", {})
        # GDAL commonly stores GRIB metadata under the empty domain "".
        md0 = md.get("", {}) if isinstance(md, dict) else {}
        if not isinstance(md0, dict):
            md0 = {}
        metas.append({k: str(v) for k, v in md0.items()})
    return metas


def find_grib_band(grib_path: Path, match: dict[str, str]) -> tuple[int, dict[str, str]]:
    metas = band_metadata(grib_path)
    for idx, md in enumerate(metas, start=1):
        ok = True
        for k, v in match.items():
            if md.get(k) != v:
                ok = False
                break
        if ok:
            return idx, md
    raise SystemExit(f"No GRIB band matched {match} in {grib_path}")


def write_colortable(path: Path, colortable: list[list[float]], scale: list[float]) -> None:
    with open(path, 'w') as f:
        scale_range = scale[1] - scale[0]
        bit_value = scale_range / 255
        for row in colortable:
            scaled_value = round((row[0] - scale[0]) / bit_value)
            scaled_row = ' '.join([str(scaled_value), *map(str, row[1:])])
            f.write(scaled_row + '\n')


def download_s3(s3_url: str, out_path: Path) -> None:
    assert s3_url.startswith("s3://")
    _, _, rest = s3_url.partition("s3://")
    bucket, _, key = rest.partition("/")

    s3 = boto3.client("s3")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading s3://{bucket}/{key} -> {out_path}", flush=True)
    s3.download_file(bucket, key, str(out_path))


def main() -> None:
    ap = argparse.ArgumentParser()

    # input/output paths
    ap.add_argument("--input", help="Local GRIB2 file path")
    ap.add_argument("--s3-url", help="s3://bucket/key to GRIB2 (signed access via IAM)")
    ap.add_argument("--workdir", default="/tmp/work", help="Scratch dir inside container")
    ap.add_argument("--out", required=True, help="Output root (tiles root)")

    # output knobs
    ap.add_argument("--cycle", required=True, help="e.g. 2026010300")
    ap.add_argument("--layer", required=True, help="e.g. temp2m")
    ap.add_argument("--hour", required=True, help="e.g. 003 (forecast hour)")
    ap.add_argument("--min-zoom", type=int, default=0)
    ap.add_argument("--max-zoom", type=int, default=6)

    args = ap.parse_args()

    layer = LAYER_CFG.get(args.layer)
    if not layer:
        raise SystemExit(f"Unknown layer: {args.layer}")

    # Select GRIB band by metadata so this works with filtered GRIB downloads.
    band = None
    band_md: dict[str, str] = {}
    lo, hi = layer["scale_min"], layer["scale_max"]
    colortable = layer["colortable"]

    if not args.input and not args.s3_url:
        raise SystemExit("Provide --input or --s3-url")

    workdir = Path(args.workdir)
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True, exist_ok=True)

    # 1) Get input GRIB2 locally
    grib_path = workdir / "input.grib2"
    if args.input:
        shutil.copy(args.input, grib_path)
    else:
        download_s3(args.s3_url, grib_path)

    grib_match = layer.get("grib_match")
    if isinstance(grib_match, dict):
        band, band_md = find_grib_band(grib_path, grib_match)
    elif "band" in layer:
        band = int(layer["band"])
    else:
        raise SystemExit(f"Layer {args.layer} must define grib_match or band")

    # If the GRIB is in Kelvin but our scale is in Celsius, shift the source scale.
    src_lo, src_hi = lo, hi
    unit = band_md.get("GRIB_UNIT")
    if unit in ("K", "[K]") and layer.get("units") == "C":
        src_lo = lo + 273.15
        src_hi = hi + 273.15

    # 2) Translate GRIB -> GeoTIFF
    tif_raw = workdir / "raw.tif"
    run([
        "gdal_translate", # https://gdal.org/programs/gdal_translate.html
        "-b", str(band),
        "-scale", str(src_lo), str(src_hi),
        "-ot", "Byte",
        "-of", "GTiff",
        "-a_nodata", "none",
        str(grib_path),
        str(tif_raw),
    ])

    # 3) Reproject to Web Mercator (EPSG:3857) for XYZ tiles
    tif_3857 = workdir / "mercator.tif"
    target_px = 256 * (1 << args.max_zoom)

    run([
        "gdalwarp", # https://gdal.org/programs/gdalwarp.html
        "-t_srs", "EPSG:3857",
        "-te_srs", "EPSG:4326",
        "-te", "-180", "-85.05112878", "180", "85.05112878",
        "-r", "cubicspline",
        "-ts", str(target_px), str(target_px),
        str(tif_raw),
        str(tif_3857),
    ])

    # 4) Generate shaded relief
    colortable_path = workdir / "color.txt"
    write_colortable(colortable_path, colortable, [lo, hi])

    tif_shaded = workdir / "shaded.tif"
    run([
        "gdaldem", # https://gdal.org/programs/gdaldem.html
        "color-relief",
        str(tif_3857),
        str(colortable_path),
        str(tif_shaded),
        "-nearest_color_entry"
    ])

    # 5) Generate MBTiles file from shaded GeoTIFF
    out_dir = Path(args.out) / args.cycle / args.layer
    out_dir.mkdir(parents=True, exist_ok=True)
    mbtiles_path = out_dir / f"{args.hour}.mbtiles"
    if mbtiles_path.exists():
        mbtiles_path.unlink()

    run([
        "gdal_translate", # https://gdal.org/programs/gdal_translate.html
        "-of", "MBTILES",
        "-co", "TILE_FORMAT=PNG",
        "-co", "ZOOM_LEVEL_STRATEGY=LOWER",
        "-co", f"NAME={args.layer} {args.cycle} {args.hour}",
        str(tif_shaded),
        str(mbtiles_path),
    ])

    # 6) Add overviews to MBTiles if needed
    if args.min_zoom < args.max_zoom:
        factors: list[str] = []
        for z in range(args.max_zoom - 1, args.min_zoom - 1, -1):
            factors.append(str(1 << (args.max_zoom - z)))  # 2,4,8,... to min_zoom
        run([
            "gdaladdo", # https://gdal.org/programs/gdaladdo.html
            "-r", "bilinear",
            str(mbtiles_path),
            *factors,
        ])

    print(f"Done. MBTiles at: {mbtiles_path}", flush=True)


if __name__ == "__main__":
    main()
