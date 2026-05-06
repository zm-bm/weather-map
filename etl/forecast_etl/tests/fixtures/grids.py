from __future__ import annotations

import struct
from typing import Any


def pack_f32(values: list[float], *, byte_order: str) -> bytes:
    prefix = "<" if byte_order == "little" else ">"
    return b"".join(struct.pack(f"{prefix}f", float(value)) for value in values)


def grid_meta_fixture() -> dict[str, Any]:
    return {
        "crs": "EPSG:4326",
        "nx": 4,
        "ny": 3,
        "lon0": -180.0,
        "lat0": 90.0,
        "dx": 0.25,
        "dy": -0.25,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def small_grid_meta_fixture() -> dict[str, Any]:
    return {
        "crs": "EPSG:4326",
        "nx": 2,
        "ny": 2,
        "lon0": -180.0,
        "lat0": 90.0,
        "dx": 0.25,
        "dy": -0.25,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }
