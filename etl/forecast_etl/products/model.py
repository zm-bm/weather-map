"""Internal product execution models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExtractedBand:
    """Float32 source bytes extracted for one configured product component."""

    component_id: str
    source_f32_bytes: bytes
    source_byte_order: str
