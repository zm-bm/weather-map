"""Weather scalar payload encoding helpers."""

from __future__ import annotations

import hashlib
import math
import struct
from pathlib import Path
from typing import Any, Mapping

from . import gdal_ops
from .config import ExecutionContext
from .contracts import ArtifactPaths, WorkItem
from .scalar_encoding import (
    SCALAR_DECODE_FORMULA,
    SCALAR_FORMAT_I8_TEMP_C_PIECEWISE,
    SCALAR_SOURCE_TRANSFORM_IDENTITY,
    SCALAR_SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR,
    SCALAR_SOURCE_TRANSFORMS,
    is_linear_scalar_format,
    scalar_format_for_encoding,
    scalar_required_nodata,
    scalar_storage_bounds,
)
from .stores.base import UriStore
from .wind_codec import extract_float32_band_bytes


def _as_float(value: Any, *, field: str, layer: str) -> float:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    raise SystemExit(f"Layer {layer} has invalid numeric field {field!r}: {value!r}")


def _as_int(value: Any, *, field: str, layer: str) -> int:
    if isinstance(value, int):
        return int(value)
    raise SystemExit(f"Layer {layer} has invalid integer field {field!r}: {value!r}")


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
        "nx": nx,
        "ny": ny,
        "lon0": lon0 + (0.5 * dx if _needs_half_cell_shift(lon0, dx) else 0.0),
        "lat0": lat0 + (0.5 * dy if _needs_half_cell_shift(lat0, dy) else 0.0),
        "dx": dx,
        "dy": dy,
    }


def _needs_half_cell_shift(origin: float, step: float) -> bool:
    if not (math.isfinite(origin) and math.isfinite(step)) or step == 0:
        return False
    normalized = origin / step
    fractional = abs(normalized - round(normalized))
    return abs(fractional - 0.5) < 1e-6


def _normalize_scalar_source_transform(raw: Any, *, layer: str) -> str:
    if raw is None:
        return SCALAR_SOURCE_TRANSFORM_IDENTITY
    if isinstance(raw, str):
        normalized = raw.strip()
        if normalized in SCALAR_SOURCE_TRANSFORMS:
            return normalized
    raise SystemExit(
        f"Layer {layer} has invalid scalar_source_transform: {raw!r}; "
        f"expected one of {sorted(SCALAR_SOURCE_TRANSFORMS)!r}"
    )


def _apply_scalar_source_transform(value: float, *, source_transform: str) -> float:
    if source_transform == SCALAR_SOURCE_TRANSFORM_IDENTITY:
        return value
    if source_transform == SCALAR_SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR:
        return value * 3600.0
    raise SystemExit(f"Unsupported scalar source transform: {source_transform!r}")


def encode_temp_c_piecewise_i8_value(value: float, *, nodata: int) -> int:
    if not math.isfinite(value):
        return nodata

    clamped = min(max(value, -35.0), 50.0)
    if clamped <= -8.0:
        idx = math.floor(((clamped + 35.0) / 0.5) + 0.5)
    elif clamped <= 34.0:
        idx = 55 + math.floor(((clamped + 7.75) / 0.25) + 0.5)
    else:
        idx = 223 + math.floor(((clamped - 34.5) / 0.5) + 0.5)

    idx = min(max(int(idx), 0), 254)
    return idx - 127


def encode_scalar_f32_to_payload(
    *,
    source_f32_bytes: bytes,
    source_byte_order: str,
    target_dtype: str,
    target_byte_order: str,
    nodata: int,
    scale: float | None = None,
    offset: float | None = None,
    target_format: str | None = None,
    source_transform: str = SCALAR_SOURCE_TRANSFORM_IDENTITY,
) -> bytes:
    """Encode float32 source bytes into scalar payload bytes."""
    if len(source_f32_bytes) % 4 != 0:
        raise SystemExit(f"Invalid float32 source byte length: {len(source_f32_bytes)}")
    if source_byte_order not in {"little", "big"}:
        raise SystemExit(f"Unsupported source byte order: {source_byte_order!r}")
    try:
        scalar_format = scalar_format_for_encoding(dtype=target_dtype, explicit_format=target_format)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    if target_dtype == "int16":
        if target_byte_order not in {"little", "big"}:
            raise SystemExit(f"Unsupported target byte order for int16: {target_byte_order!r}")
        target_pack = "<h" if target_byte_order == "little" else ">h"
        target_item_bytes = 2
    elif target_dtype == "int8":
        if target_byte_order != "none":
            raise SystemExit(f"Unsupported target byte order for int8: {target_byte_order!r}")
        target_pack = "b"
        target_item_bytes = 1
    else:
        raise SystemExit(f"Unsupported scalar target dtype: {target_dtype!r}")
    if is_linear_scalar_format(scalar_format):
        if scale is None or scale == 0 or not math.isfinite(scale):
            raise SystemExit(f"Invalid scalar scale (must be finite and non-zero): {scale!r}")
        if offset is None or not math.isfinite(offset):
            raise SystemExit(f"Invalid scalar offset (must be finite): {offset!r}")
    min_stored, max_stored = scalar_storage_bounds(target_dtype)
    if nodata < min_stored or nodata > max_stored:
        raise SystemExit(f"Invalid {target_dtype} nodata sentinel: {nodata!r}")
    required_nodata = scalar_required_nodata(scalar_format)
    if required_nodata is not None and nodata != required_nodata:
        raise SystemExit(f"Invalid nodata sentinel for {scalar_format}: {nodata!r}")

    normalized_transform = _normalize_scalar_source_transform(source_transform, layer="__internal__")
    source_unpack = "<f" if source_byte_order == "little" else ">f"

    out = bytearray((len(source_f32_bytes) // 4) * target_item_bytes)
    offset_bytes = 0
    for (raw_value,) in struct.iter_unpack(source_unpack, source_f32_bytes):
        if not math.isfinite(raw_value):
            stored = nodata
        else:
            transformed_value = _apply_scalar_source_transform(
                float(raw_value),
                source_transform=normalized_transform,
            )
            if not math.isfinite(transformed_value):
                stored = nodata
            elif scalar_format == SCALAR_FORMAT_I8_TEMP_C_PIECEWISE:
                stored = encode_temp_c_piecewise_i8_value(transformed_value, nodata=nodata)
            else:
                stored = int(round((transformed_value - offset) / scale))
                if stored < min_stored:
                    stored = min_stored
                elif stored > max_stored:
                    stored = max_stored
                if stored == nodata:
                    stored = stored + 1 if stored < max_stored else stored - 1

        struct.pack_into(target_pack, out, offset_bytes, stored)
        offset_bytes += target_item_bytes

    return bytes(out)


def encode_scalar_f32_to_i16_payload(
    *,
    source_f32_bytes: bytes,
    source_byte_order: str,
    target_byte_order: str,
    scale: float,
    offset: float,
    nodata: int,
    source_transform: str = SCALAR_SOURCE_TRANSFORM_IDENTITY,
) -> bytes:
    """Encode float32 source bytes into scalar-i16-linear-v1 payload bytes."""
    return encode_scalar_f32_to_payload(
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
        target_dtype="int16",
        target_byte_order=target_byte_order,
        scale=scale,
        offset=offset,
        nodata=nodata,
        source_transform=source_transform,
    )


def run_scalar_item_in_workdir(
    *,
    workdir: Path,
    ctx: ExecutionContext,
    item: WorkItem,
    layer: Mapping[str, Any],
    store: UriStore,
    grib_path: Path,
    run: gdal_ops.RunFn,
) -> dict[str, Any]:
    """Extract one weather GRIB band and encode scalar payload."""

    layer_key = str(item.layer)
    scalar_encoding = layer.get("scalar_encoding")
    if not isinstance(scalar_encoding, Mapping):
        raise SystemExit(f"Layer {layer_key} missing required object field 'scalar_encoding'")

    encoding_id_raw = scalar_encoding.get("encoding_id")
    encoding_id = encoding_id_raw.strip() if isinstance(encoding_id_raw, str) else ""
    if not encoding_id:
        raise SystemExit(f"Layer {layer_key} has invalid scalar_encoding.encoding_id: {encoding_id_raw!r}")

    dtype = str(scalar_encoding.get("dtype", "")).strip()
    byte_order = str(scalar_encoding.get("byte_order", "")).strip()
    explicit_format = scalar_encoding.get("format")
    try:
        scalar_format = scalar_format_for_encoding(
            dtype=dtype,
            explicit_format=explicit_format.strip() if isinstance(explicit_format, str) else None,
        )
    except ValueError as exc:
        raise SystemExit(f"Layer {layer_key} has invalid scalar_encoding.format: {exc}") from exc

    scale = (
        _as_float(scalar_encoding.get("scale"), field="scalar_encoding.scale", layer=layer_key)
        if is_linear_scalar_format(scalar_format)
        else None
    )
    offset = (
        _as_float(scalar_encoding.get("offset"), field="scalar_encoding.offset", layer=layer_key)
        if is_linear_scalar_format(scalar_format)
        else None
    )
    nodata = _as_int(scalar_encoding.get("nodata"), field="scalar_encoding.nodata", layer=layer_key)
    source_transform = _normalize_scalar_source_transform(
        layer.get("scalar_source_transform"),
        layer=layer_key,
    )
    valid_min = _as_float(layer.get("scale_min"), field="scale_min", layer=layer_key)
    valid_max = _as_float(layer.get("scale_max"), field="scale_max", layer=layer_key)
    units = str(layer.get("units", "")).strip()
    parameter = str(layer.get("parameter", "")).strip()
    level = str(layer.get("level", "")).strip()
    grib_match = layer.get("grib_match")
    if not isinstance(grib_match, Mapping):
        raise SystemExit(f"Layer {layer_key} must define grib_match")

    min_stored, max_stored = scalar_storage_bounds(dtype)
    if nodata < min_stored or nodata > max_stored:
        raise SystemExit(f"Layer {layer_key} scalar_encoding.nodata out of {dtype} range: {nodata!r}")

    grib_band_idx, grib_band_md = gdal_ops.find_grib_band_by_metadata(
        grib_path,
        grib_match,
        run=run,
    )
    source_f32_bytes, source_byte_order = extract_float32_band_bytes(
        grib_path=grib_path,
        band_idx=grib_band_idx,
        workdir_path=workdir / f"{layer_key}.scalar.f32.bin",
        run=run,
    )

    grid = _grid_meta_from_grib(grib_path=grib_path, run=run)
    nx = int(grid["nx"])
    ny = int(grid["ny"])
    expected_source_bytes = nx * ny * 4
    if len(source_f32_bytes) != expected_source_bytes:
        raise SystemExit(
            f"Unexpected scalar source byte length for {layer_key}: "
            f"got={len(source_f32_bytes)} expected={expected_source_bytes}"
        )

    payload = encode_scalar_f32_to_payload(
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
        target_dtype=dtype,
        target_byte_order=byte_order,
        target_format=scalar_format,
        scale=scale,
        offset=offset,
        nodata=nodata,
        source_transform=source_transform,
    )

    ap = ArtifactPaths(ctx.artifact_root_uri)
    payload_uri = ap.output_scalar_payload_uri(item, dtype=dtype)
    store.write_bytes(uri=payload_uri, data=payload)
    digest = hashlib.sha256(payload).hexdigest()

    result = {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": digest,
        "format": scalar_format,
        "dtype": dtype,
        "byte_order": byte_order,
        "encoding_id": encoding_id,
        "nodata": nodata,
        "source_transform": source_transform,
        "source_byte_order": source_byte_order,
        "units": units,
        "parameter": parameter,
        "level": level,
        "valid_min": valid_min,
        "valid_max": valid_max,
        "band_index": grib_band_idx,
        "grib_match": {str(k): str(v) for k, v in grib_match.items()},
        "band_metadata": {str(k): str(v) for k, v in grib_band_md.items()},
        "grid": {
            "crs": "EPSG:4326",
            "nx": nx,
            "ny": ny,
            "lon0": float(grid["lon0"]),
            "lat0": float(grid["lat0"]),
            "dx": float(grid["dx"]),
            "dy": float(grid["dy"]),
            "origin": "cell_center",
            "layout": "row_major",
            "x_wrap": "repeat",
            "y_mode": "clamp",
        },
    }
    if is_linear_scalar_format(scalar_format):
        result["decode_formula"] = SCALAR_DECODE_FORMULA
        result["scale"] = scale
        result["offset"] = offset
    return result
