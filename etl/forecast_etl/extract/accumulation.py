"""Helpers for deriving rates from accumulation fields."""

from __future__ import annotations

import math
import struct

from ..encoding.numeric import FLOAT32_BYTE_ORDERS

# ICON accumulated precipitation can dip slightly after GRIB packing and
# regridding. 0.01 kg/m^2 is 0.01 mm over an hour, well below the current
# 0.15 mm/hr precipitation-rate encoding step.
NEGATIVE_ACCUMULATION_DELTA_TOLERANCE = 0.01


def accumulation_delta_rate_bytes(
    *,
    current_bytes: bytes,
    current_byte_order: str,
    previous_bytes: bytes,
    previous_byte_order: str,
    interval_seconds: float,
    product_id: str,
    component_id: str,
) -> bytes:
    """Return float32 rate bytes from adjacent accumulation fields."""

    if len(current_bytes) != len(previous_bytes):
        raise SystemExit(
            f"Accumulation byte length mismatch for {product_id}.{component_id}: "
            f"current={len(current_bytes)} previous={len(previous_bytes)}"
        )
    if interval_seconds <= 0 or not math.isfinite(interval_seconds):
        raise SystemExit(f"Invalid accumulation interval for {product_id}.{component_id}: {interval_seconds!r}")
    if current_byte_order not in FLOAT32_BYTE_ORDERS:
        raise SystemExit(f"Unsupported current float32 byte order: {current_byte_order!r}")
    if previous_byte_order not in FLOAT32_BYTE_ORDERS:
        raise SystemExit(f"Unsupported previous float32 byte order: {previous_byte_order!r}")

    current_fmt = "<f" if current_byte_order == "little" else ">f"
    previous_fmt = "<f" if previous_byte_order == "little" else ">f"
    out = bytearray(len(current_bytes))

    for index, (current_item, previous_item) in enumerate(
        zip(
            struct.iter_unpack(current_fmt, current_bytes),
            struct.iter_unpack(previous_fmt, previous_bytes),
            strict=True,
        )
    ):
        current_value = float(current_item[0])
        previous_value = float(previous_item[0])
        if not (math.isfinite(current_value) and math.isfinite(previous_value)):
            rate = math.nan
        else:
            delta = current_value - previous_value
            if delta < -NEGATIVE_ACCUMULATION_DELTA_TOLERANCE:
                raise SystemExit(
                    f"Negative accumulation delta for {product_id}.{component_id} at cell {index}: "
                    f"current={current_value!r} previous={previous_value!r} delta={delta!r}"
                )
            rate = max(delta, 0.0) / interval_seconds
        struct.pack_into(current_fmt, out, index * 4, rate)

    return bytes(out)
