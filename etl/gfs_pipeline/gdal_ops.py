"""GDAL command helpers.

This module builds argv for GDAL utilities and parses a small amount of GDAL
output (e.g. `gdalinfo -json`).

It intentionally contains no direct subprocess calls: callers provide a
`run(argv) -> RunResult` callback so execution can be local, containerized, etc.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence, Mapping, Iterable

from .proc import RunFn, RunResult


@dataclass(frozen=True)
class TranslateOpts:
    """Options for `gdal_translate`."""
    band: Optional[int] = None
    scale_min: Optional[float] = None
    scale_max: Optional[float] = None
    output_type: Optional[str] = None
    output_format: Optional[str] = None
    a_nodata: Optional[str] = None
    creation_options: tuple[str, ...] = ()


def gdal_translate(src: Path, dst: Path, *, opts: TranslateOpts, run: RunFn) -> RunResult:
    """Run `gdal_translate` with the provided options."""
    argv: list[str] = ["gdal_translate"]
    if opts.band is not None:
        argv += ["-b", str(int(opts.band))]
    if opts.scale_min is not None and opts.scale_max is not None:
        argv += ["-scale", str(opts.scale_min), str(opts.scale_max)]
    if opts.output_type is not None:
        argv += ["-ot", opts.output_type]
    if opts.output_format is not None:
        argv += ["-of", opts.output_format]
    if opts.a_nodata is not None:
        argv += ["-a_nodata", opts.a_nodata]
    for co in opts.creation_options:
        argv += ["-co", co]
    argv += [str(src), str(dst)]
    return run(argv)


@dataclass(frozen=True)
class WarpOpts:
    """Options for `gdalwarp`."""
    t_srs: Optional[str] = None
    te_srs: Optional[str] = None
    te: Optional[tuple[float, float, float, float]] = None
    resampling: Optional[str] = None
    ts: Optional[tuple[int, int]] = None
    extra_args: tuple[str, ...] = ()


def gdalwarp(src: Path, dst: Path, *, opts: WarpOpts, run: RunFn) -> RunResult:
    """Run `gdalwarp` with the provided options."""
    argv: list[str] = ["gdalwarp"]
    if opts.t_srs is not None:
        argv += ["-t_srs", opts.t_srs]
    if opts.te_srs is not None:
        argv += ["-te_srs", opts.te_srs]
    if opts.te is not None:
        xmin, ymin, xmax, ymax = opts.te
        argv += ["-te", str(xmin), str(ymin), str(xmax), str(ymax)]
    if opts.resampling is not None:
        argv += ["-r", opts.resampling]
    if opts.ts is not None:
        x_px, y_px = opts.ts
        argv += ["-ts", str(int(x_px)), str(int(y_px))]
    argv += list(opts.extra_args)
    argv += [str(src), str(dst)]
    return run(argv)


def warp_web_mercator_xyz(
    src: Path,
    dst: Path,
    *,
    max_zoom: int,
    run: RunFn,
    resampling: str = "cubicspline",
) -> RunResult:
    """Warp a raster into Web Mercator using an XYZ-style extent/size."""

    target_px = 256 * (1 << int(max_zoom))
    return gdalwarp(
        src,
        dst,
        opts=WarpOpts(
            t_srs="EPSG:3857",
            te_srs="EPSG:4326",
            te=(-180.0, -85.05112878, 180.0, 85.05112878),
            resampling=resampling,
            ts=(target_px, target_px),
        ),
        run=run,
    )


def format_color_relief_table(
    *,
    colortable: Iterable[Sequence[float]],
    scale_min: float,
    scale_max: float,
) -> str:
    """Return the text content for gdaldem color-relief table.

    Input rows are expected like: [value, r, g, b, a] (or similar),
    where `value` is in the original (unscaled) domain.
    """
    lo, hi = float(scale_min), float(scale_max)
    scale_range = hi - lo
    if scale_range <= 0:
        raise SystemExit(f"Invalid scale range for color table: [{lo}, {hi}]")

    bit_value = scale_range / 255.0

    lines: list[str] = []
    for row in colortable:
        if len(row) < 2:
            raise SystemExit(f"Invalid colortable row (need value + colors): {row}")

        raw_value = float(row[0])
        scaled_value = round((raw_value - lo) / bit_value)
        scaled_value = max(0, min(255, int(scaled_value)))

        # Preserve remaining columns as-is
        lines.append(" ".join([str(scaled_value), *map(str, row[1:])]))

    return "\n".join(lines) + "\n"


def gdaldem_color_relief(
    src: Path,
    color_table: Path,
    dst: Path,
    *,
    run: RunFn,
    nearest_color_entry: bool = True,
) -> RunResult:
    """Apply a color-relief table via `gdaldem color-relief`."""
    argv = ["gdaldem", "color-relief", str(src), str(color_table), str(dst)]
    if nearest_color_entry:
        argv.append("-nearest_color_entry")
    return run(argv)


def translate_to_mbtiles_png(
    src: Path,
    dst: Path,
    *,
    run: RunFn,
    name: str,
    tile_format: str = "PNG",
    zoom_level_strategy: str = "LOWER",
) -> RunResult:
    """Translate a raster into an MBTiles container (PNG tiles)."""
    return gdal_translate(
        src,
        dst,
        opts=TranslateOpts(
            output_format="MBTILES",
            creation_options=(
                f"TILE_FORMAT={tile_format}",
                f"ZOOM_LEVEL_STRATEGY={zoom_level_strategy}",
                f"NAME={name}",
            ),
        ),
        run=run,
    )


def gdaladdo(mbtiles: Path, *, run: RunFn, resampling: str, factors: Sequence[int]) -> RunResult:
    """Add internal overviews with `gdaladdo` for the provided factors."""
    argv: list[str] = ["gdaladdo", "-r", resampling, str(mbtiles), *[str(int(x)) for x in factors]]
    return run(argv)


def add_mbtiles_overviews(
    mbtiles: Path,
    *,
    run: RunFn,
    min_zoom: int,
    max_zoom: int,
    resampling: str = "bilinear",
) -> RunResult:
    """Add internal overviews to an MBTiles, matching the worker's factor logic."""

    if int(min_zoom) >= int(max_zoom):
        # No overviews needed (or invalid range). Treat as no-op.
        return RunResult(argv=("gdaladdo",), returncode=0)

    factors: list[int] = []
    for z in range(int(max_zoom) - 1, int(min_zoom) - 1, -1):
        factors.append(1 << (int(max_zoom) - z))
    return gdaladdo(mbtiles, run=run, resampling=resampling, factors=factors)


def gdalinfo_json(path: Path, *, run: RunFn) -> dict:
    """Return parsed JSON from `gdalinfo -json` for the given dataset."""
    res = run(["gdalinfo", "-json", str(path)])
    try:
        return json.loads(res.stdout)
    except Exception as e:
        raise RuntimeError(
            f"Failed to parse gdalinfo JSON for {path}: {e}\n"
            f"stdout:\n{res.stdout}\n"
            f"stderr:\n{res.stderr}"
        ) from e


def find_grib_band_by_metadata(
    grib_path: Path,
    match: Mapping[str, str],
    *,
    run: RunFn,
) -> tuple[int, dict[str, str]]:
    """Find a GRIB band by matching `gdalinfo -json` band metadata.

    Returns `(band_index_1_based, band_metadata)` for the first band matching
    all key/value pairs in `match`.
    """
    info = gdalinfo_json(grib_path, run=run)
    bands = info.get("bands", [])
    for idx, band in enumerate(bands, start=1):
        md = band.get("metadata", {})
        md0 = md.get("", {}) if isinstance(md, dict) else {}
        if not isinstance(md0, dict):
            md0 = {}

        band_md = {k: str(v) for k, v in md0.items()}
        if all(band_md.get(k) == v for k, v in match.items()):
            return idx, band_md

    raise SystemExit(f"No GRIB band matched {dict(match)} in {grib_path}")
