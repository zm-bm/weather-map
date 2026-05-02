"""Stable manifest revision hashing."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable, Mapping

from .constants import FORECAST_BINARY_CONTRACT, MANIFEST_VERSION


def compute_manifest_revision(
    *,
    cycle: str,
    hours: Iterable[str],
    scalar_variables: Iterable[str],
    scalar_variable_groups: Iterable[Mapping[str, Any]],
    vector_variables: Iterable[str],
    grids: Mapping[str, Mapping[str, Any]],
    encodings: Mapping[str, Mapping[str, Any]],
    variable_meta: Mapping[str, Mapping[str, Any]],
    frames: Mapping[str, Mapping[str, Mapping[str, Any]]],
) -> str:
    basis = {
        "contract": FORECAST_BINARY_CONTRACT,
        "version": MANIFEST_VERSION,
        "cycle": cycle,
        "forecast_hours": list(hours),
        "scalar_variables": list(scalar_variables),
        "scalar_variable_groups": list(scalar_variable_groups),
        "vector_variables": list(vector_variables),
        "grids": grids,
        "encodings": encodings,
        "variable_meta": variable_meta,
        "frames": frames,
    }
    digest = hashlib.sha256(json.dumps(basis, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]
