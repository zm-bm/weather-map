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
from .stores.base import UriStore
from .wind_codec import extract_float32_band_bytes

SCALAR_FORMAT = "scalar-i16-linear-v1"
SCALAR_DTYPE = "int16"
SCALAR_DECODE_FORMULA = "value = stored * scale + offset"
SCALAR_SOURCE_TRANSFORM_IDENTITY = "identity"


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
    if isinstance(raw, str) and raw.strip() == SCALAR_SOURCE_TRANSFORM_IDENTITY:
        return SCALAR_SOURCE_TRANSFORM_IDENTITY
    raise SystemExit(
        f"Layer {layer} has invalid scalar_source_transform: {raw!r}; "
        f"expected {SCALAR_SOURCE_TRANSFORM_IDENTITY!r}"
    )


def _apply_scalar_source_transform(value: float, *, source_transform: str) -> float:
    if source_transform == SCALAR_SOURCE_TRANSFORM_IDENTITY:
        return value
    raise SystemExit(f"Unsupported scalar source transform: {source_transform!r}")


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
    if len(source_f32_bytes) % 4 != 0:
        raise SystemExit(f"Invalid float32 source byte length: {len(source_f32_bytes)}")
    if source_byte_order not in {"little", "big"}:
        raise SystemExit(f"Unsupported source byte order: {source_byte_order!r}")
    if target_byte_order not in {"little", "big"}:
        raise SystemExit(f"Unsupported target byte order: {target_byte_order!r}")
    if scale == 0 or not math.isfinite(scale):
        raise SystemExit(f"Invalid scalar scale (must be finite and non-zero): {scale!r}")
    if nodata < -32768 or nodata > 32767:
        raise SystemExit(f"Invalid int16 nodata sentinel: {nodata!r}")

    normalized_transform = _normalize_scalar_source_transform(source_transform, layer="__internal__")
    source_unpack = "<f" if source_byte_order == "little" else ">f"
    target_pack = "<h" if target_byte_order == "little" else ">h"

    out = bytearray((len(source_f32_bytes) // 4) * 2)
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
            else:
                stored = int(round((transformed_value - offset) / scale))
                if stored < -32768:
                    stored = -32768
                elif stored > 32767:
                    stored = 32767
                if stored == nodata:
                    stored = stored + 1 if stored < 32767 else stored - 1

        struct.pack_into(target_pack, out, offset_bytes, stored)
        offset_bytes += 2

    return bytes(out)


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
    """Extract one weather GRIB band and encode scalar-i16 payload."""

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
    if dtype != SCALAR_DTYPE:
        raise SystemExit(f"Layer {layer_key} scalar_encoding.dtype must be 'int16', got: {dtype!r}")
    if byte_order not in {"little", "big"}:
        raise SystemExit(
            f"Layer {layer_key} scalar_encoding.byte_order must be 'little' or 'big', got: {byte_order!r}"
        )

    scale = _as_float(scalar_encoding.get("scale"), field="scalar_encoding.scale", layer=layer_key)
    offset = _as_float(scalar_encoding.get("offset"), field="scalar_encoding.offset", layer=layer_key)
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

    if nodata < -32768 or nodata > 32767:
        raise SystemExit(f"Layer {layer_key} scalar_encoding.nodata out of int16 range: {nodata!r}")

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

    payload = encode_scalar_f32_to_i16_payload(
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
        target_byte_order=byte_order,
        scale=scale,
        offset=offset,
        nodata=nodata,
        source_transform=source_transform,
    )

    ap = ArtifactPaths(ctx.artifact_root_uri)
    payload_uri = ap.output_scalar_payload_uri(item)
    store.write_bytes(uri=payload_uri, data=payload)
    digest = hashlib.sha256(payload).hexdigest()

    return {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": digest,
        "format": SCALAR_FORMAT,
        "dtype": SCALAR_DTYPE,
        "byte_order": byte_order,
        "decode_formula": SCALAR_DECODE_FORMULA,
        "encoding_id": encoding_id,
        "scale": scale,
        "offset": offset,
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
