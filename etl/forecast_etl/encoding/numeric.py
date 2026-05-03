"""Low-level numeric byte encoding helpers."""

from __future__ import annotations

import struct
from collections.abc import Iterator

FLOAT32_BYTE_ORDERS = {"little", "big"}
INT_STORAGE_BOUNDS_BY_DTYPE = {
    "int8": (-128, 127),
    "int16": (-32768, 32767),
}
INT_ITEM_BYTES_BY_DTYPE = {
    "int8": 1,
    "int16": 2,
}

def iter_float32_values(data: bytes, *, byte_order: str) -> Iterator[float]:
    if len(data) % 4 != 0:
        raise SystemExit(f"Invalid float32 byte length: {len(data)}")
    if byte_order not in FLOAT32_BYTE_ORDERS:
        raise SystemExit(f"Unsupported float32 byte order: {byte_order!r}")

    fmt = "<f" if byte_order == "little" else ">f"
    for (value,) in struct.iter_unpack(fmt, data):
        yield value


def int_storage_bounds(dtype: str) -> tuple[int, int]:
    try:
        return INT_STORAGE_BOUNDS_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported integer dtype: {dtype!r}") from exc


def int_item_bytes(dtype: str) -> int:
    try:
        return INT_ITEM_BYTES_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported integer dtype: {dtype!r}") from exc


def signed_int_pack_format(*, dtype: str, byte_order: str) -> str:
    if dtype == "int8":
        if byte_order != "none":
            raise SystemExit(f"Unsupported byte order for int8: {byte_order!r}")
        return "b"
    if dtype == "int16":
        if byte_order not in {"little", "big"}:
            raise SystemExit(f"Unsupported byte order for int16: {byte_order!r}")
        return "<h" if byte_order == "little" else ">h"
    raise SystemExit(f"Unsupported signed integer dtype: {dtype!r}")


def clamp_int(value: int, *, bounds: tuple[int, int]) -> int:
    min_value, max_value = bounds
    if value < min_value:
        return min_value
    if value > max_value:
        return max_value
    return value
