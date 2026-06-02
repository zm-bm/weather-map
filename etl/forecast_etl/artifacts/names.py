"""Artifact naming helpers shared by storage readers and payload encoders."""

from __future__ import annotations

PAYLOAD_SUFFIX_BY_DTYPE = {
    "int16": "i16",
    "int8": "i8",
}


def payload_suffix_for_dtype(dtype: str) -> str:
    """Return the artifact filename dtype suffix for a payload dtype."""

    try:
        return PAYLOAD_SUFFIX_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc
