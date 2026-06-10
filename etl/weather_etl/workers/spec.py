"""Shared worker specs and stable execution serialization."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FrameWorkerSpec:
    """One frame worker command/env spec with stable execution serialization."""

    frame_id: str
    env: Mapping[str, str]
    command: tuple[str, ...]
    source_uri: str | None = None

    @property
    def worker_spec_hash(self) -> str:
        return worker_spec_hash(self.base_plan_dict())

    def base_plan_dict(self) -> dict[str, Any]:
        return {
            "frame_id": self.frame_id,
            "env": dict(self.env),
            "command": list(self.command),
        }

    def to_plan_dict(self) -> dict[str, Any]:
        worker = self.base_plan_dict()
        worker["worker_spec_hash"] = self.worker_spec_hash
        return worker


def worker_spec_hash(worker: Mapping[str, Any]) -> str:
    """Return the stable worker hash used in plan JSON and Batch claims."""

    return hashlib.sha256(json.dumps(worker, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
