"""Vector product execution helpers."""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import Any, Mapping

from . import gdal_ops
from .config import ExecutionContext
from .contracts import ArtifactPaths, WorkItem
from .stores.base import UriStore
from .wind_codec import extract_float32_band_bytes, quantize_f32_to_i8_q0p5

WIND_FORMAT = "uv-i8-q0p5-v1"
WIND_DTYPE = "int8"
WIND_BYTE_ORDER = "none"
WIND_SCALE = 0.5
WIND_OFFSET = 0.0
WIND_COMPONENTS = ["u", "v"]
WIND_COMPONENT_COUNT = 2
WIND_COMPONENT_ORDER = "u_then_v"
WIND_DECODE_FORMULA = "value = stored * scale + offset"
WIND_GRID_ID = "gfs_0p25_global"
WIND_DEFAULT_UNITS = "m/s"
WIND_DEFAULT_PARAMETER = "wind_uv"
WIND_DEFAULT_LEVEL = "10m_above_ground"
WIND_DEFAULT_VALID_MIN = -64.0
WIND_DEFAULT_VALID_MAX = 63.5


def _needs_half_cell_shift(origin: float, step: float) -> bool:
    if not (math.isfinite(origin) and math.isfinite(step)) or step == 0:
        return False
    normalized = origin / step
    fractional = abs(normalized - round(normalized))
    return abs(fractional - 0.5) < 1e-6


def _grid_meta_from_grib(*, grib_path: Path, run: gdal_ops.RunFn) -> dict[str, float | int]:
    info = gdal_ops.gdalinfo_json(grib_path, run=run)
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


def run_vector_item_in_workdir(
    *,
    workdir: Path,
    ctx: ExecutionContext,
    item: WorkItem,
    vector_variable: Mapping[str, Any],
    store: UriStore,
    grib_path: Path,
    run: gdal_ops.RunFn,
) -> dict[str, Any]:
    """Extract U/V payload, quantize, publish payload, and return manifest-ready metadata."""

    u_match = vector_variable.get("u_grib_match")
    v_match = vector_variable.get("v_grib_match")
    if not isinstance(u_match, Mapping):
        raise SystemExit(f"Wind layer {item.layer} missing object field 'u_grib_match'")
    if not isinstance(v_match, Mapping):
        raise SystemExit(f"Wind layer {item.layer} missing object field 'v_grib_match'")

    u_band_idx, _ = gdal_ops.find_grib_band_by_metadata(grib_path, u_match, run=run)
    v_band_idx, _ = gdal_ops.find_grib_band_by_metadata(grib_path, v_match, run=run)

    u_f32_bytes, u_source_byte_order = extract_float32_band_bytes(
        grib_path=grib_path,
        band_idx=u_band_idx,
        workdir_path=workdir / "u.bin",
        run=run,
    )
    v_f32_bytes, v_source_byte_order = extract_float32_band_bytes(
        grib_path=grib_path,
        band_idx=v_band_idx,
        workdir_path=workdir / "v.bin",
        run=run,
    )

    u_bytes = quantize_f32_to_i8_q0p5(u_f32_bytes, byte_order=u_source_byte_order)
    v_bytes = quantize_f32_to_i8_q0p5(v_f32_bytes, byte_order=v_source_byte_order)

    grid_meta = _grid_meta_from_grib(grib_path=grib_path, run=run)
    nx, ny = int(grid_meta["nx"]), int(grid_meta["ny"])
    component_bytes = nx * ny
    if len(u_bytes) != component_bytes:
        raise SystemExit(
            f"Unexpected U payload size for {item.layer}: got={len(u_bytes)} expected={component_bytes}"
        )
    if len(v_bytes) != component_bytes:
        raise SystemExit(
            f"Unexpected V payload size for {item.layer}: got={len(v_bytes)} expected={component_bytes}"
        )

    ap = ArtifactPaths(ctx.artifact_root_uri)
    payload_uri = ap.output_vector_payload_uri(item)
    payload_bytes = u_bytes + v_bytes
    store.write_bytes(uri=payload_uri, data=payload_bytes)
    digest = hashlib.sha256(payload_bytes).hexdigest()

    units_raw = vector_variable.get("units")
    units = str(units_raw).strip() if isinstance(units_raw, str) and units_raw.strip() else WIND_DEFAULT_UNITS

    parameter_raw = vector_variable.get("parameter")
    parameter = (
        str(parameter_raw).strip()
        if isinstance(parameter_raw, str) and parameter_raw.strip()
        else WIND_DEFAULT_PARAMETER
    )

    level_raw = vector_variable.get("level")
    level = str(level_raw).strip() if isinstance(level_raw, str) and level_raw.strip() else WIND_DEFAULT_LEVEL

    valid_min_raw = vector_variable.get("valid_min")
    valid_min = float(valid_min_raw) if isinstance(valid_min_raw, (int, float)) else WIND_DEFAULT_VALID_MIN

    valid_max_raw = vector_variable.get("valid_max")
    valid_max = float(valid_max_raw) if isinstance(valid_max_raw, (int, float)) else WIND_DEFAULT_VALID_MAX

    encoding_id_raw = vector_variable.get("encoding_id")
    encoding_id = (
        str(encoding_id_raw).strip()
        if isinstance(encoding_id_raw, str) and encoding_id_raw.strip()
        else f"{item.layer}_vector_i8_v1"
    )

    return {
        "payload_uri": payload_uri,
        "byte_length": len(payload_bytes),
        "sha256": digest,
        "format": WIND_FORMAT,
        "dtype": WIND_DTYPE,
        "byte_order": WIND_BYTE_ORDER,
        "scale": WIND_SCALE,
        "offset": WIND_OFFSET,
        "decode_formula": WIND_DECODE_FORMULA,
        "components": WIND_COMPONENTS,
        "component_count": WIND_COMPONENT_COUNT,
        "component_order": WIND_COMPONENT_ORDER,
        "encoding_id": encoding_id,
        "units": units,
        "parameter": parameter,
        "level": level,
        "valid_min": valid_min,
        "valid_max": valid_max,
        "grid_id": WIND_GRID_ID,
        "grid": grid_meta,
    }
