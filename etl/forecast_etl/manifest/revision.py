"""Stable manifest revision hashing."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any, Mapping


def compute_manifest_revision(manifest_obj: Mapping[str, Any]) -> str:
    """Compute the stable revision hash for a manifest object."""

    basis = _revision_basis(manifest_obj)
    digest = hashlib.sha256(json.dumps(basis, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]


def _revision_basis(manifest_obj: Mapping[str, Any]) -> dict[str, Any]:
    basis = deepcopy(dict(manifest_obj))
    run = basis.get("run")
    if isinstance(run, dict):
        run.pop("generatedAt", None)
        run.pop("revision", None)
    return basis
