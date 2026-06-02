"""Read-only cycle submission planning."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from ..cycles import parse_cycle
from ..frame_claims import FrameClaimStore, worker_spec_hash
from ..frame_evidence import FrameEvidence, inspect_frame_evidence
from ..run_ids import generate_run_id, parse_run_id
from ..run_metadata import json_document_digest
from ..run_snapshots import LoadedRunSnapshot
from .context import ApplicationContext
from .cycle import resolve_artifact_ids

PLAN_SCHEMA = "weather-map.etl-cycle-submission-plan"
PLAN_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class CycleSubmissionPlan:
    """Provider-neutral description of one cycle submission attempt."""

    plan: dict[str, Any]


def plan_cycle(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    publish: bool,
    claim_store: FrameClaimStore | None = None,
    source_uris_by_frame: Mapping[str, str] | None = None,
    now: datetime | None = None,
    loaded_snapshot: LoadedRunSnapshot | None = None,
) -> CycleSubmissionPlan:
    """Build a read-only plan for local/AWS executors."""

    parse_cycle(cycle)
    resolved_run_id = parse_run_id(run_id) if run_id else generate_run_id()
    snapshot = loaded_snapshot
    try:
        if snapshot is None:
            snapshot = app_context.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id)
        dataset = snapshot.loaded_config.config.dataset(dataset_id)
        config_digest = snapshot.config_digest
    except FileNotFoundError:
        runtime = app_context.resolve_dataset_runtime(dataset_id)
        dataset = runtime.dataset
        config_digest = json_document_digest(runtime.loaded_config.raw)
    frames = _resolve_frames(configured=dataset.workload.frames, selected=selected_frames)
    artifact_ids = resolve_artifact_ids(dataset, selected_artifacts)
    paths = app_context.artifact_repo.paths
    pipeline_config_uri = paths.run_pipeline_config_uri(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id)
    forecast_catalog_uri = paths.run_forecast_catalog_uri(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id)
    frame_source_uris = dict(source_uris_by_frame or {})
    effective_now = now or datetime.now(timezone.utc)

    common_env = {
        "ARTIFACT_ROOT_URI": app_context.artifact_root_uri,
        "PIPELINE_CONFIG_URI": pipeline_config_uri,
        "FORECAST_CATALOG_URI": forecast_catalog_uri,
        "DATASET_ID": dataset_id,
        "CYCLE": cycle,
        "RUN_ID": resolved_run_id,
    }
    for metadata_env in ("ETL_CODE_REVISION", "ETL_IMAGE_IDENTITY"):
        value = os.environ.get(metadata_env)
        if value:
            common_env[metadata_env] = value
    artifact_flags = [flag for artifact_id in artifact_ids for flag in ("--artifact", artifact_id)]
    frame_states = []
    workers = []
    for frame_id in frames:
        evidence = (
            inspect_frame_evidence(
                artifact_repo=app_context.artifact_repo,
                dataset=dataset,
                cycle=cycle,
                run_id=resolved_run_id,
                snapshot=snapshot,
                frame_id=frame_id,
                artifact_ids=artifact_ids,
            )
            if snapshot is not None
            else FrameEvidence(
                frame_id=frame_id,
                state="pending",
                expected_marker_count=len(artifact_ids),
                observed_marker_count=0,
            )
        )
        state = evidence.state
        claim = claim_store.get(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id, frame_id=frame_id) if claim_store else None
        claim_dict = None
        if (
            claim is not None
            and claim.state == "claimed"
            and claim.expires_at_epoch > int(effective_now.timestamp())
            and state in {"pending", "missing"}
        ):
            state = "claimed"
            claim_dict = {
                "state": claim.state,
                "attempt": claim.attempt,
                "expires_at_epoch": claim.expires_at_epoch,
                "job_id": claim.job_id,
            }
        worker_env = {**common_env, "FRAME_ID": frame_id}
        source_uri = frame_source_uris.get(frame_id)
        if source_uri:
            worker_env["GRIB_SOURCE_URI"] = source_uri
        worker = {
            "frame_id": frame_id,
            "env": worker_env,
            "command": [
                "forecast-etl",
                "run-frame",
                "--dataset-id",
                dataset_id,
                "--cycle",
                cycle,
                "--run-id",
                resolved_run_id,
                "--frame-id",
                frame_id,
                *artifact_flags,
            ],
        }
        worker["worker_spec_hash"] = worker_spec_hash(worker)
        frame_states.append({
            "frame_id": frame_id,
            "state": state,
            "eligible_for_submission": state in {"pending", "missing"},
            "expected_marker_count": evidence.expected_marker_count,
            "observed_marker_count": evidence.observed_marker_count,
            "missing_marker_count": len(evidence.missing_markers),
            "missing_markers": list(evidence.missing_markers[:5]),
            "errors": list(evidence.errors[:5]),
            "claim": claim_dict,
            "source_uri": source_uri,
            "worker_spec_hash": worker["worker_spec_hash"],
        })
        if state in {"pending", "missing"}:
            workers.append(worker)

    validation_command = [
        "forecast-etl",
        "validate-cycle",
        "--dataset-id",
        dataset_id,
        "--cycle",
        cycle,
        "--run-id",
        resolved_run_id,
    ]
    publish_command = [
        "forecast-etl",
        "publish-cycle",
        "--dataset-id",
        dataset_id,
        "--cycle",
        cycle,
        "--run-id",
        resolved_run_id,
    ]
    return CycleSubmissionPlan(
        plan={
            "schema": PLAN_SCHEMA,
            "schema_version": PLAN_SCHEMA_VERSION,
            "dataset_id": dataset_id,
            "cycle": cycle,
            "run_id": resolved_run_id,
            "artifact_root_uri": app_context.artifact_root_uri,
            "source_pipeline_config_uri": app_context.pipeline_config_uri,
            "source_forecast_catalog_uri": app_context.forecast_catalog_uri,
            "config_digest": config_digest,
            "run_snapshot": {
                "pipeline_config_uri": pipeline_config_uri,
                "forecast_catalog_uri": forecast_catalog_uri,
            },
            "snapshot_exists": snapshot is not None,
            "resume": run_id is not None,
            "frame_ids": list(frames),
            "frames": list(frames),
            "frame_states": frame_states,
            "artifact_ids": list(artifact_ids),
            "workers": workers,
            "validation": {
                "env": common_env,
                "command": validation_command,
            },
            "publish": {
                "env": common_env,
                "command": publish_command,
            } if publish else None,
        }
    )


def parse_frame_selection(raw: str | None) -> tuple[str, ...] | None:
    """Parse a whitespace/comma separated frame selection."""

    if raw is None or not raw.strip():
        return None
    parts = tuple(part.strip() for part in raw.replace(",", " ").split() if part.strip())
    if not parts:
        raise SystemExit("--frames requires at least one frame id")
    return tuple(_normalize_frame(part, index=index) for index, part in enumerate(parts))


def _resolve_frames(*, configured: Iterable[str], selected: Iterable[str] | None) -> tuple[str, ...]:
    configured_frames = tuple(str(frame_id) for frame_id in configured)
    if selected is None:
        return configured_frames
    requested = tuple(selected)
    unknown = [frame_id for frame_id in requested if frame_id not in configured_frames]
    if unknown:
        raise SystemExit(
            f"Unknown frame id(s): {unknown!r}; configured frames: {list(configured_frames)!r}"
        )
    requested_set = set(requested)
    return tuple(frame_id for frame_id in configured_frames if frame_id in requested_set)


def _normalize_frame(raw: str, *, index: int) -> str:
    if not raw.isdigit():
        raise SystemExit(f"--frames[{index}] must be an integer frame")
    value = int(raw, 10)
    if value < 0 or value > 999:
        raise SystemExit(f"--frames[{index}] must be in the range 0..999")
    return f"{value:03d}"
