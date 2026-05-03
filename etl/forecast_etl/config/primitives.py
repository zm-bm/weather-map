"""Small config parsing primitives shared by validators."""

from __future__ import annotations

import math
from typing import Any


def parse_non_empty_string(raw_value: Any, *, field_name: str) -> str:
    if not isinstance(raw_value, str) or not raw_value.strip():
        raise SystemExit(f"{field_name} must be a non-empty string")
    return raw_value.strip()


def parse_finite_float(raw_value: Any, *, field_name: str) -> float:
    if not isinstance(raw_value, (int, float)) or not math.isfinite(float(raw_value)):
        raise SystemExit(f"{field_name} must be a finite number")
    return float(raw_value)


def parse_string_tuple(raw_value: Any, *, field_name: str) -> tuple[str, ...]:
    if not isinstance(raw_value, list) or not raw_value:
        raise SystemExit(f"{field_name} must be a non-empty array")

    values: list[str] = []
    for index, raw_item in enumerate(raw_value):
        if not isinstance(raw_item, str) or not raw_item.strip():
            raise SystemExit(f"{field_name}[{index}] must be a non-empty string")
        values.append(raw_item.strip())

    return tuple(values)


def parse_unique_string_tuple(raw_value: Any, *, field_name: str) -> tuple[str, ...]:
    values = parse_string_tuple(raw_value, field_name=field_name)
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise SystemExit(f"{field_name} contains duplicate value: {value!r}")
        seen.add(value)
    return values
