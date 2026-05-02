"""Wind payload encoding helpers."""

from __future__ import annotations

import math
import struct

WIND_FORMAT = "uv-i8-q0p5-v1"
WIND_DTYPE = "int8"
WIND_BYTE_ORDER = "none"
WIND_SCALE = 0.5
WIND_OFFSET = 0.0
WIND_COMPONENT_ORDER = "u_then_v"
WIND_DECODE_FORMULA = "value = stored * scale + offset"

__all__ = [
    "WIND_BYTE_ORDER",
    "WIND_COMPONENT_ORDER",
    "WIND_DECODE_FORMULA",
    "WIND_DTYPE",
    "WIND_FORMAT",
    "WIND_OFFSET",
    "WIND_SCALE",
    "quantize_f32_to_i8_q0p5",
]


def quantize_f32_to_i8_q0p5(data: bytes, *, byte_order: str) -> bytes:
    """Quantize float32 m/s values to int8 with 0.5 m/s precision."""
    if len(data) % 4 != 0:
        raise SystemExit(f"Invalid float32 byte length: {len(data)}")

    fmt = "<f" if byte_order == "little" else ">f"
    out = bytearray(len(data) // 4)
    for i, (value,) in enumerate(struct.iter_unpack(fmt, data)):
        if math.isfinite(value):
            q = int(round(value * 2.0))
            if q < -128:
                q = -128
            elif q > 127:
                q = 127
        else:
            q = 0
        out[i] = q & 0xFF
    return bytes(out)
