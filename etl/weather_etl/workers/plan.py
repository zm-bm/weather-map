"""Typed cycle plan carriers and stable operator serialization."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from .spec import FrameWorkerSpec

PLAN_SCHEMA = "weather-map.etl-cycle-submission-plan"
PLAN_SCHEMA_VERSION = 2
FramePlanState = Literal["pending", "missing", "complete", "invalid", "claimed"]


@dataclass(frozen=True)
class CycleCommandPlan:
    """One planned CLI command plus environment."""

    env: Mapping[str, str]
    command: tuple[str, ...]

    def to_operator_dict(self) -> dict[str, Any]:
        return {
            "env": dict(self.env),
            "command": list(self.command),
        }


@dataclass(frozen=True)
class FrameStatePlan:
    """One frame's completion/claim state in a cycle plan."""

    frame_id: str
    state: FramePlanState
    eligible_for_submission: bool
    expected_marker_count: int
    observed_marker_count: int
    missing_marker_count: int
    missing_markers: tuple[str, ...]
    errors: tuple[str, ...]
    claim: dict[str, Any] | None
    source_uri: str | None
    worker_spec_hash: str

    def to_operator_dict(self) -> dict[str, Any]:
        return {
            "frame_id": self.frame_id,
            "state": self.state,
            "eligible_for_submission": self.eligible_for_submission,
            "expected_marker_count": self.expected_marker_count,
            "observed_marker_count": self.observed_marker_count,
            "missing_marker_count": self.missing_marker_count,
            "missing_markers": list(self.missing_markers),
            "errors": list(self.errors),
            "claim": self.claim,
            "source_uri": self.source_uri,
            "worker_spec_hash": self.worker_spec_hash,
        }


@dataclass(frozen=True)
class CyclePlan:
    """Typed cycle plan used by operations, with stable operator serialization."""

    dataset_id: str
    cycle: str
    run_id: str
    artifact_root_uri: str
    source_pipeline_uri: str
    source_catalog_uri: str
    product_config_digest: str
    pipeline_uri: str
    catalog_uri: str
    snapshot_exists: bool
    resume: bool
    frame_ids: tuple[str, ...]
    artifact_ids: tuple[str, ...]
    workers: tuple[FrameWorkerSpec, ...]
    frame_states: tuple[FrameStatePlan, ...]
    validation: CycleCommandPlan
    publish: CycleCommandPlan | None

    def worker_for_frame(self, frame_id: str) -> FrameWorkerSpec | None:
        """Return the planned worker for a frame, if one exists."""

        return next((worker for worker in self.workers if worker.frame_id == frame_id), None)

    def to_operator_dict(self) -> dict[str, Any]:
        return {
            "schema": PLAN_SCHEMA,
            "schema_version": PLAN_SCHEMA_VERSION,
            "dataset_id": self.dataset_id,
            "cycle": self.cycle,
            "run_id": self.run_id,
            "artifact_root_uri": self.artifact_root_uri,
            "source_pipeline_uri": self.source_pipeline_uri,
            "source_catalog_uri": self.source_catalog_uri,
            "product_config_digest": self.product_config_digest,
            "run_snapshot": {
                "pipeline_uri": self.pipeline_uri,
                "catalog_uri": self.catalog_uri,
            },
            "snapshot_exists": self.snapshot_exists,
            "resume": self.resume,
            "frame_ids": list(self.frame_ids),
            "frames": list(self.frame_ids),
            "frame_states": [state.to_operator_dict() for state in self.frame_states],
            "artifact_ids": list(self.artifact_ids),
            "workers": [worker.to_plan_dict() for worker in self.workers],
            "validation": self.validation.to_operator_dict(),
            "publish": self.publish.to_operator_dict() if self.publish is not None else None,
        }
