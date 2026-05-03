"""Product source value transform identifiers and helpers."""

from __future__ import annotations

from typing import Any, Callable

SOURCE_TRANSFORM_IDENTITY = "identity"
SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR = "kg_m2_s_to_mm_hr"
SOURCE_TRANSFORMS = {
    SOURCE_TRANSFORM_IDENTITY,
    SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR,
}

SourceValueTransform = Callable[[float], float]


def normalize_source_transform(raw: Any, *, field_name: str) -> str:
    if raw is None:
        return SOURCE_TRANSFORM_IDENTITY
    if isinstance(raw, str):
        normalized = raw.strip()
        if normalized in SOURCE_TRANSFORMS:
            return normalized
    raise SystemExit(f"{field_name} must be one of {sorted(SOURCE_TRANSFORMS)!r}, got: {raw!r}")


def source_value_transform(source_transform: str) -> SourceValueTransform:
    normalized = normalize_source_transform(source_transform, field_name="source_transform")
    if normalized == SOURCE_TRANSFORM_IDENTITY:
        return _identity
    if normalized == SOURCE_TRANSFORM_KG_M2_S_TO_MM_HR:
        return _kg_m2_s_to_mm_hr
    raise SystemExit(f"Unsupported source transform: {source_transform!r}")


def _identity(value: float) -> float:
    return value


def _kg_m2_s_to_mm_hr(value: float) -> float:
    return value * 3600.0
