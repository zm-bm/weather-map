"""GDAL-backed GRIB grid and band extraction helpers."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from . import gdal

MATCH_OPERATOR_SEPARATOR = "__"
MATCH_OPERATOR_PREFIX = "prefix"


def _needs_half_cell_shift(origin: float, step: float) -> bool:
    if not (math.isfinite(origin) and math.isfinite(step)) or step == 0:
        return False
    normalized = origin / step
    fractional = abs(normalized - round(normalized))
    return abs(fractional - 0.5) < 1e-6


def grid_meta_from_grib(*, grib_path: Path, run: gdal.RunFn) -> dict[str, Any]:
    """Read frontend grid metadata from a GRIB file via GDAL."""

    info = gdal.gdalinfo_json(grib_path, run=run)
    size = info.get("size")
    gt = info.get("geoTransform")
    if not (isinstance(size, list) and len(size) == 2):
        raise SystemExit(f"Unexpected gdalinfo size for {grib_path}: {size!r}")
    if not (isinstance(gt, list) and len(gt) == 6):
        raise SystemExit(f"Unexpected geotransform for {grib_path}: {gt!r}")

    nx, ny = int(size[0]), int(size[1])
    lon0 = float(gt[0])
    lat0 = float(gt[3])
    dx = float(gt[1])
    dy = float(gt[5])

    return {
        "crs": "EPSG:4326",
        "nx": nx,
        "ny": ny,
        "lon0": lon0 + (0.5 * dx if _needs_half_cell_shift(lon0, dx) else 0.0),
        "lat0": lat0 + (0.5 * dy if _needs_half_cell_shift(lat0, dy) else 0.0),
        "dx": dx,
        "dy": dy,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def extract_float32_band_bytes(
    *,
    grib_path: Path,
    band_idx: int,
    workdir_path: Path,
    run: gdal.RunFn,
) -> tuple[bytes, str]:
    """Extract one GRIB band into contiguous Float32 bytes (row-major)."""
    gdal.gdal_translate(
        grib_path,
        workdir_path,
        opts=gdal.TranslateOpts(
            band=band_idx,
            output_type="Float32",
            output_format="ENVI",
            creation_options=("INTERLEAVE=BSQ",),
        ),
        run=run,
    )

    # ENVI sidecar header stores byte order as 0=little, 1=big.
    hdr_path = workdir_path.with_suffix(".hdr")
    byte_order = "little"
    if hdr_path.exists():
        try:
            for line in hdr_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                normalized = line.strip().lower()
                if normalized.startswith("byte order"):
                    parts = normalized.split("=", 1)
                    if len(parts) == 2:
                        value = parts[1].strip()
                        if value == "0":
                            byte_order = "little"
                        elif value == "1":
                            byte_order = "big"
                    break
        except Exception:
            pass

    return workdir_path.read_bytes(), byte_order


def find_grib_band_by_metadata(
    grib_path: Path,
    match: dict[str, str],
    *,
    run: gdal.RunFn,
) -> tuple[int, dict[str, str]]:
    """Find a GRIB band by matching `gdalinfo -json` band metadata.

    Returns `(band_index_1_based, band_metadata)` for the first band matching
    all key/value pairs in `match`.
    """
    info = gdal.gdalinfo_json(grib_path, run=run)
    bands = info.get("bands", [])
    for idx, band in enumerate(bands, start=1):
        md = band.get("metadata", {})
        md0 = md.get("", {}) if isinstance(md, dict) else {}
        if not isinstance(md0, dict):
            md0 = {}

        band_md = {k: str(v) for k, v in md0.items()}
        if _metadata_matches(band_md=band_md, match=match):
            return idx, band_md

    raise SystemExit(f"No GRIB band matched {dict(match)} in {grib_path}")


def _metadata_matches(*, band_md: dict[str, str], match: dict[str, str]) -> bool:
    for key, expected in match.items():
        if MATCH_OPERATOR_SEPARATOR in key:
            metadata_key, operator = key.rsplit(MATCH_OPERATOR_SEPARATOR, 1)
            if operator == MATCH_OPERATOR_PREFIX:
                if not band_md.get(metadata_key, "").startswith(expected):
                    return False
                continue
        if band_md.get(key) != expected:
            return False
    return True
