"""Shared Float32 byte helpers for processing."""

from __future__ import annotations

import struct
import sys
from array import array
from collections.abc import Iterator

FLOAT32_BYTE_ORDERS = {"little", "big"}


def float32_pack_format(byte_order: str) -> str:
    """Return a struct format prefix for a supported Float32 byte order."""

    if byte_order not in FLOAT32_BYTE_ORDERS:
        raise SystemExit(f"Unsupported float32 byte order: {byte_order!r}")
    return "<f" if byte_order == "little" else ">f"


def iter_float32_values(data: bytes, *, byte_order: str) -> Iterator[float]:
    """Iterate packed float32 values using the declared byte order."""

    if len(data) % 4 != 0:
        raise SystemExit(f"Invalid float32 byte length: {len(data)}")

    fmt = float32_pack_format(byte_order)
    for (value,) in struct.iter_unpack(fmt, data):
        yield value


def float32_array_from_bytes(data: bytes, *, byte_order: str) -> array:
    """Return an array of Float32 values using the declared byte order."""

    float32_pack_format(byte_order)
    if len(data) % 4 != 0:
        raise SystemExit(f"Invalid float32 byte length: {len(data)}")

    values = array("f")
    if values.itemsize != 4:
        raise SystemExit("Platform array('f') is not 32-bit")
    values.frombytes(data)
    if byte_order != sys.byteorder:
        values.byteswap()
    return values


def float32_array_to_little_endian_bytes(values: array) -> bytes:
    """Return Float32 array bytes encoded as little-endian values."""

    if sys.byteorder == "little":
        return values.tobytes()
    out = array("f", values)
    out.byteswap()
    return out.tobytes()
