"""Internal product execution models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ExtractedBand:
    component_id: str
    grib_match: dict[str, str]
    source_f32_bytes: bytes
    source_byte_order: str
    band_index: int
    band_metadata: dict[str, str]


@dataclass(frozen=True)
class EncodedComponent:
    component_id: str
    payload_bytes: bytes
    source_byte_order: str
    band_index: int
    band_metadata: dict[str, str]
    grib_match: dict[str, str]
