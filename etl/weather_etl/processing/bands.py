"""Shared processing band data structures."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExtractedBand:
    """Float32 source bytes for one extracted output or intermediate band."""

    component_id: str
    source_f32_bytes: bytes
    source_byte_order: str
