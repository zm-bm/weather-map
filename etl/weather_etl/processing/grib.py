"""GDAL-backed GRIB grid and band extraction helpers."""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from weather_etl.config.pipeline import ArtifactSpec
from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.float32 import float32_pack_format
from weather_etl.processing.proc import RunFn
from weather_etl.sources.prepared_grib import PreparedGribSource

MATCH_OPERATOR_SEPARATOR = "__"
MATCH_OPERATOR_PREFIX = "prefix"


@dataclass(frozen=True)
class GribBand:
    index: int
    metadata: dict[str, str]
    nodata_value: float | None


def gdalinfo_json(path: Path, *, run: RunFn) -> dict[str, Any]:
    """Return parsed JSON from `gdalinfo -json` for the given dataset."""
    res = run(["gdalinfo", "-json", str(path)])
    try:
        return json.loads(res.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(
            f"Failed to parse gdalinfo JSON for {path}: {e}\nstdout:\n{res.stdout}\nstderr:\n{res.stderr}"
        ) from e


def _needs_half_cell_shift(origin: float, step: float) -> bool:
    if not (math.isfinite(origin) and math.isfinite(step)) or step == 0:
        return False
    normalized = origin / step
    fractional = abs(normalized - round(normalized))
    return abs(fractional - 0.5) < 1e-6


def grid_meta_from_grib(*, grib_path: Path, run: RunFn) -> dict[str, Any]:
    """Read frontend grid metadata from a GRIB file via GDAL."""

    info = gdalinfo_json(grib_path, run=run)
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
    nodata_value: float | None,
    workdir_path: Path,
    run: RunFn,
) -> tuple[bytes, str]:
    """Extract one GRIB band into contiguous Float32 bytes (row-major)."""
    run(
        [
            "gdal_translate",
            "-b",
            str(int(band_idx)),
            "-ot",
            "Float32",
            "-of",
            "ENVI",
            "-co",
            "INTERLEAVE=BSQ",
            str(grib_path),
            str(workdir_path),
        ]
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
        except OSError:
            pass

    source_f32_bytes = workdir_path.read_bytes()
    if nodata_value is not None:
        source_f32_bytes = _replace_grib_nodata_with_nan(
            source_f32_bytes,
            byte_order=byte_order,
            nodata_value=nodata_value,
        )

    return source_f32_bytes, byte_order


def find_grib_band(
    grib_path: Path,
    match: dict[str, str],
    *,
    run: RunFn,
) -> GribBand:
    """Find a GRIB band by matching `gdalinfo -json` band metadata.

    Returns the first band matching all key/value pairs in `match`.
    """
    info = gdalinfo_json(grib_path, run=run)
    bands = info.get("bands", [])
    for idx, band in enumerate(bands, start=1):
        md = band.get("metadata", {}) if isinstance(band, dict) else {}
        md0 = md.get("", {}) if isinstance(md, dict) else {}
        if not isinstance(md0, dict):
            md0 = {}

        band_md = {k: str(v) for k, v in md0.items()}
        if _metadata_matches(band_md=band_md, match=match):
            return GribBand(
                index=idx,
                metadata=band_md,
                nodata_value=_band_nodata_value(band),
            )

    raise SystemExit(f"No GRIB band matched {dict(match)} in {grib_path}")


def extract_grib_source_band(
    *,
    artifact: ArtifactSpec,
    band_id: str,
    grib_match: dict[str, str],
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir_path: Path,
    run: RunFn,
) -> ExtractedBand:
    """Find and extract one configured GRIB band as Float32 bytes."""

    grib_path = source.component_grib_path(
        artifact_id=artifact.id,
        component_id=band_id,
        grib_match=grib_match,
    )
    band = find_grib_band(
        grib_path,
        {key: value for key, value in grib_match.items() if key.startswith("GRIB_")},
        run=run,
    )
    source_f32_bytes, source_byte_order = extract_float32_band_bytes(
        grib_path=grib_path,
        band_idx=band.index,
        nodata_value=band.nodata_value,
        workdir_path=workdir_path,
        run=run,
    )

    expected_source_bytes = int(grid["nx"]) * int(grid["ny"]) * 4
    if len(source_f32_bytes) != expected_source_bytes:
        raise SystemExit(
            f"Unexpected source band byte length for {artifact.id}.{band_id}: "
            f"got={len(source_f32_bytes)} expected={expected_source_bytes}"
        )

    return ExtractedBand(
        component_id=band_id,
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
    )


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


def _band_nodata_value(band: object) -> float | None:
    if not isinstance(band, dict):
        return None
    raw_value = band.get("noDataValue")
    if raw_value is None:
        return None

    try:
        nodata_value = float(raw_value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(nodata_value):
        return None
    return nodata_value


def _replace_grib_nodata_with_nan(
    source_f32_bytes: bytes,
    *,
    byte_order: str,
    nodata_value: float,
) -> bytes:
    if len(source_f32_bytes) % 4 != 0:
        raise SystemExit("Unexpected Float32 source byte length")

    try:
        float_format = float32_pack_format(byte_order)
    except SystemExit:
        raise SystemExit(f"Unsupported Float32 source byte_order: {byte_order!r}")

    nodata_bytes = struct.pack(float_format, nodata_value)
    nan_bytes = struct.pack(float_format, math.nan)
    out = bytearray(source_f32_bytes)
    for offset in range(0, len(out), 4):
        if out[offset : offset + 4] == nodata_bytes:
            out[offset : offset + 4] = nan_bytes
    return bytes(out)
