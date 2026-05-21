"""Artifact grid transform helpers."""

from __future__ import annotations

import math
import sys
from array import array
from dataclasses import dataclass
from typing import Any

from ..config.resolved import ArtifactSpec
from .types import ExtractedBand

GRID_TRANSFORM_REGULAR_DOWNSAMPLE_2X = "regular_grid_downsample_2x"
FLOAT32_BYTE_ORDERS = {"little", "big"}


@dataclass(frozen=True)
class ArtifactGridTransformResult:
    grid_id: str
    grid: dict[str, Any]
    bands: list[ExtractedBand]


def apply_artifact_grid_transform(
    *,
    artifact: ArtifactSpec,
    grid_id: str,
    grid: dict[str, Any],
    bands: list[ExtractedBand],
) -> ArtifactGridTransformResult:
    """Apply an optional artifact-local grid transform before payload encoding."""

    transform = artifact.grid_transform
    if transform is None:
        return ArtifactGridTransformResult(grid_id=grid_id, grid=grid, bands=bands)

    if transform.type != GRID_TRANSFORM_REGULAR_DOWNSAMPLE_2X:
        raise SystemExit(f"Unsupported grid transform for {artifact.id}: {transform.type!r}")

    target_grid = regular_grid_downsample_2x_meta(grid)
    target_bands = [
        ExtractedBand(
            component_id=band.component_id,
            source_f32_bytes=regular_grid_downsample_2x_bytes(
                band.source_f32_bytes,
                byte_order=band.source_byte_order,
                grid=grid,
            ),
            source_byte_order="little",
        )
        for band in bands
    ]
    return ArtifactGridTransformResult(grid_id=transform.grid_id, grid=target_grid, bands=target_bands)


def regular_grid_downsample_2x_meta(grid: dict[str, Any]) -> dict[str, Any]:
    """Return grid metadata for a stride-2 regular-grid downsample."""

    nx = int(grid["nx"])
    ny = int(grid["ny"])
    if nx < 1 or ny < 1:
        raise SystemExit(f"Cannot downsample empty grid: nx={nx} ny={ny}")

    return {
        **grid,
        "nx": (nx + 1) // 2,
        "ny": (ny + 1) // 2,
        "dx": float(grid["dx"]) * 2.0,
        "dy": float(grid["dy"]) * 2.0,
    }


def regular_grid_downsample_2x_bytes(source_f32_bytes: bytes, *, byte_order: str, grid: dict[str, Any]) -> bytes:
    """Downsample a Float32 regular grid using a light 3x3 [1 2 1] prefilter."""

    source = _float32_array_from_bytes(source_f32_bytes, byte_order=byte_order)
    target_grid = regular_grid_downsample_2x_meta(grid)
    nx = int(grid["nx"])
    ny = int(grid["ny"])
    target_nx = int(target_grid["nx"])
    target_ny = int(target_grid["ny"])
    expected = nx * ny
    if len(source) != expected:
        raise SystemExit(f"Unexpected source grid byte length: got={len(source) * 4} expected={expected * 4}")

    x_wrap = str(grid.get("x_wrap", "")).lower() == "repeat"
    target = array("f", [math.nan]) * (target_nx * target_ny)
    for target_y in range(target_ny):
        center_y = target_y * 2
        for target_x in range(target_nx):
            center_x = target_x * 2
            target[(target_y * target_nx) + target_x] = _downsampled_cell_value(
                source=source,
                nx=nx,
                ny=ny,
                center_x=center_x,
                center_y=center_y,
                x_wrap=x_wrap,
            )

    return _float32_array_to_little_endian_bytes(target)


def _downsampled_cell_value(
    *,
    source: array,
    nx: int,
    ny: int,
    center_x: int,
    center_y: int,
    x_wrap: bool,
) -> float:
    weighted_total = 0.0
    total_weight = 0.0
    for y_offset, y_weight in ((-1, 1.0), (0, 2.0), (1, 1.0)):
        y = center_y + y_offset
        if y < 0 or y >= ny:
            continue
        for x_offset, x_weight in ((-1, 1.0), (0, 2.0), (1, 1.0)):
            x = center_x + x_offset
            if x_wrap:
                x %= nx
            elif x < 0 or x >= nx:
                continue
            value = float(source[(y * nx) + x])
            if not math.isfinite(value):
                continue
            weight = x_weight * y_weight
            weighted_total += value * weight
            total_weight += weight

    return weighted_total / total_weight if total_weight > 0.0 else math.nan


def _float32_array_from_bytes(data: bytes, *, byte_order: str) -> array:
    if byte_order not in FLOAT32_BYTE_ORDERS:
        raise SystemExit(f"Unsupported float32 byte order: {byte_order!r}")
    if len(data) % 4 != 0:
        raise SystemExit(f"Invalid float32 byte length: {len(data)}")

    values = array("f")
    if values.itemsize != 4:
        raise SystemExit("Platform array('f') is not 32-bit")
    values.frombytes(data)
    if byte_order != sys.byteorder:
        values.byteswap()
    return values


def _float32_array_to_little_endian_bytes(values: array) -> bytes:
    if sys.byteorder == "little":
        return values.tobytes()
    out = array("f", values)
    out.byteswap()
    return out.tobytes()
