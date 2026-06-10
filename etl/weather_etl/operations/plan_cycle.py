"""Read-only cycle submission planning."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Protocol

from ..config.pipeline import DatasetConfig
from ..config.product import product_config_digest as compute_product_config_digest
from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..state.runs.completion import FrameCompletion, inspect_frame_completion
from ..state.runs.ids import generate_run_id, parse_run_id
from ..state.runs.snapshots import LoadedRunSnapshot
from ..workers.plan import CycleCommandPlan, CyclePlan, FramePlanState, FrameStatePlan
from ..workers.spec import FrameWorkerSpec
from .workload_selection import (
    WorkloadSelectionError,
    selected_workload_artifact_ids,
    selected_workload_frame_ids,
)

_FRAME_STATE_SAMPLE_LIMIT = 5


@dataclass(frozen=True)
class _CyclePlanContext:
    run_id: str
    dataset: DatasetConfig
    snapshot: LoadedRunSnapshot | None
    product_config_digest: str
    pipeline_uri: str
    catalog_uri: str
    resume: bool


class _ClaimView(Protocol):
    """Read-only claim shape used by cycle planning."""

    state: str
    attempt: int
    expires_at_epoch: int
    job_id: str | None


class _ClaimReader(Protocol):
    """Read-only claim lookup used by cycle planning."""

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> _ClaimView | None:
        """Return a persisted frame claim, if present."""
        ...


def plan_cycle(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    publish: bool,
    claim_store: _ClaimReader | None = None,
    source_uris_by_frame: Mapping[str, str] | None = None,
    now: datetime | None = None,
    loaded_snapshot: LoadedRunSnapshot | None = None,
) -> CyclePlan:
    """Build a read-only plan for local/AWS execution."""

    parse_cycle(cycle)
    context = _load_planning_context(
        env=env,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        loaded_snapshot=loaded_snapshot,
    )
    try:
        frames = selected_workload_frame_ids(configured=context.dataset.workload.frames, selected=selected_frames)
        artifact_ids = selected_workload_artifact_ids(context.dataset, selected_artifacts)
    except WorkloadSelectionError as exc:
        raise SystemExit(str(exc)) from None
    frame_source_uris = dict(source_uris_by_frame or {})
    effective_now = now or datetime.now(timezone.utc)
    common_env = _common_worker_env(env=env, context=context, dataset_id=dataset_id, cycle=cycle)
    artifact_flags = _artifact_flags(artifact_ids)
    frame_states: list[FrameStatePlan] = []
    workers: list[FrameWorkerSpec] = []
    for frame_id in frames:
        frame_state, worker = _plan_frame(
            env=env,
            context=context,
            dataset_id=dataset_id,
            cycle=cycle,
            frame_id=frame_id,
            artifact_ids=artifact_ids,
            artifact_flags=artifact_flags,
            common_env=common_env,
            claim_store=claim_store,
            source_uri=frame_source_uris.get(frame_id),
            now=effective_now,
        )
        frame_states.append(frame_state)
        if worker is not None:
            workers.append(worker)

    return CyclePlan(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=context.run_id,
        artifact_root_uri=env.artifact_root_uri,
        source_pipeline_uri=env.pipeline_uri,
        source_catalog_uri=env.catalog_uri,
        product_config_digest=context.product_config_digest,
        pipeline_uri=context.pipeline_uri,
        catalog_uri=context.catalog_uri,
        snapshot_exists=context.snapshot is not None,
        resume=context.resume,
        frame_ids=frames,
        artifact_ids=artifact_ids,
        workers=tuple(workers),
        frame_states=tuple(frame_states),
        validation=_command_plan(
            env=common_env,
            command=_stage_command("validate-cycle", dataset_id=dataset_id, cycle=cycle, run_id=context.run_id),
        ),
        publish=(
            _command_plan(
                env=common_env,
                command=_stage_command("publish-cycle", dataset_id=dataset_id, cycle=cycle, run_id=context.run_id),
            )
            if publish
            else None
        ),
    )


def _load_planning_context(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    loaded_snapshot: LoadedRunSnapshot | None,
) -> _CyclePlanContext:
    resolved_run_id = _resolved_planning_run_id(run_id=run_id, loaded_snapshot=loaded_snapshot)
    snapshot = loaded_snapshot
    try:
        if snapshot is None:
            snapshot = env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id)
        dataset = snapshot.dataset(dataset_id)
        digest = snapshot.product_config_digest
    except FileNotFoundError:
        runtime = env.resolve_dataset_runtime(dataset_id)
        dataset = runtime.dataset
        digest = compute_product_config_digest(runtime.product_config)

    paths = env.artifact_repo.paths
    return _CyclePlanContext(
        run_id=resolved_run_id,
        dataset=dataset,
        snapshot=snapshot,
        product_config_digest=digest,
        pipeline_uri=paths.run_pipeline_uri(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id),
        catalog_uri=paths.run_catalog_uri(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id),
        resume=run_id is not None,
    )


def _resolved_planning_run_id(*, run_id: str | None, loaded_snapshot: LoadedRunSnapshot | None) -> str:
    if loaded_snapshot is None:
        return parse_run_id(run_id) if run_id else generate_run_id()
    if run_id is None:
        return loaded_snapshot.run_id

    resolved_run_id = parse_run_id(run_id)
    if resolved_run_id != loaded_snapshot.run_id:
        raise SystemExit(
            f"Loaded run snapshot mismatch: expected run_id={resolved_run_id} found={loaded_snapshot.run_id}"
        )
    return resolved_run_id


def _common_worker_env(
    *,
    env: EtlEnvironment,
    context: _CyclePlanContext,
    dataset_id: str,
    cycle: str,
) -> dict[str, str]:
    worker_env = {
        "ARTIFACT_ROOT_URI": env.artifact_root_uri,
        "PIPELINE_URI": context.pipeline_uri,
        "CATALOG_URI": context.catalog_uri,
        "DATASET_ID": dataset_id,
        "CYCLE": cycle,
        "RUN_ID": context.run_id,
    }
    for metadata_env in ("ETL_CODE_REVISION", "ETL_IMAGE_IDENTITY"):
        value = os.environ.get(metadata_env)
        if value:
            worker_env[metadata_env] = value
    return worker_env


def _plan_frame(
    *,
    env: EtlEnvironment,
    context: _CyclePlanContext,
    dataset_id: str,
    cycle: str,
    frame_id: str,
    artifact_ids: tuple[str, ...],
    artifact_flags: tuple[str, ...],
    common_env: Mapping[str, str],
    claim_store: _ClaimReader | None,
    source_uri: str | None,
    now: datetime,
) -> tuple[FrameStatePlan, FrameWorkerSpec | None]:
    completion = _frame_completion(
        env=env,
        context=context,
        cycle=cycle,
        frame_id=frame_id,
        artifact_ids=artifact_ids,
    )
    state: FramePlanState = completion.state
    claim = (
        claim_store.get(dataset_id=dataset_id, cycle=cycle, run_id=context.run_id, frame_id=frame_id)
        if claim_store
        else None
    )
    claim_payload = None
    if claim is not None and _claim_blocks_submission(claim=claim, state=state, now=now):
        state = "claimed"
        claim_payload = _claim_dict(claim)

    worker = _frame_worker_plan(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=context.run_id,
        frame_id=frame_id,
        artifact_flags=artifact_flags,
        common_env=common_env,
        source_uri=source_uri,
    )
    worker_spec_hash = worker.worker_spec_hash
    frame_state = _frame_state_plan(
        completion=completion,
        state=state,
        claim=claim_payload,
        source_uri=source_uri,
        worker_spec_hash=worker_spec_hash,
    )
    return frame_state, worker if _is_submittable_frame_state(state) else None


def _frame_completion(
    *,
    env: EtlEnvironment,
    context: _CyclePlanContext,
    cycle: str,
    frame_id: str,
    artifact_ids: tuple[str, ...],
) -> FrameCompletion:
    if context.snapshot is None:
        return FrameCompletion(
            frame_id=frame_id,
            state="pending",
            expected_marker_count=len(artifact_ids),
            observed_marker_count=0,
        )
    return inspect_frame_completion(
        artifact_repo=env.artifact_repo,
        dataset=context.dataset,
        cycle=cycle,
        run_id=context.run_id,
        snapshot=context.snapshot,
        frame_id=frame_id,
        artifact_ids=artifact_ids,
    )


def _claim_blocks_submission(*, claim: _ClaimView, state: FramePlanState, now: datetime) -> bool:
    return (
        claim.state == "claimed" and claim.expires_at_epoch > int(now.timestamp()) and state in {"pending", "missing"}
    )


def _is_submittable_frame_state(state: FramePlanState) -> bool:
    return state in {"pending", "missing"}


def _frame_state_plan(
    *,
    completion: FrameCompletion,
    state: FramePlanState,
    claim: dict[str, Any] | None,
    source_uri: str | None,
    worker_spec_hash: str,
) -> FrameStatePlan:
    missing_markers = tuple(completion.missing_markers[:_FRAME_STATE_SAMPLE_LIMIT])
    errors = tuple(completion.errors[:_FRAME_STATE_SAMPLE_LIMIT])
    return FrameStatePlan(
        frame_id=completion.frame_id,
        state=state,
        eligible_for_submission=_is_submittable_frame_state(state),
        expected_marker_count=completion.expected_marker_count,
        observed_marker_count=completion.observed_marker_count,
        missing_marker_count=len(completion.missing_markers),
        missing_markers=missing_markers,
        errors=errors,
        claim=claim,
        source_uri=source_uri,
        worker_spec_hash=worker_spec_hash,
    )


def _claim_dict(claim: _ClaimView) -> dict[str, Any]:
    return {
        "state": claim.state,
        "attempt": claim.attempt,
        "expires_at_epoch": claim.expires_at_epoch,
        "job_id": claim.job_id,
    }


def _frame_worker_plan(
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    artifact_flags: tuple[str, ...],
    common_env: Mapping[str, str],
    source_uri: str | None,
) -> FrameWorkerSpec:
    worker_env = {**common_env, "FRAME_ID": frame_id}
    if source_uri:
        worker_env["GRIB_SOURCE_URI"] = source_uri
    return FrameWorkerSpec(
        frame_id=frame_id,
        env=worker_env,
        command=(
            "weather-etl",
            "run-frame",
            "--dataset-id",
            dataset_id,
            "--cycle",
            cycle,
            "--run-id",
            run_id,
            "--frame-id",
            frame_id,
            *artifact_flags,
        ),
        source_uri=source_uri,
    )


def _artifact_flags(artifact_ids: Iterable[str]) -> tuple[str, ...]:
    return tuple(flag for artifact_id in artifact_ids for flag in ("--artifact", artifact_id))


def _stage_command(command_name: str, *, dataset_id: str, cycle: str, run_id: str) -> tuple[str, ...]:
    return (
        "weather-etl",
        command_name,
        "--dataset-id",
        dataset_id,
        "--cycle",
        cycle,
        "--run-id",
        run_id,
    )


def _command_plan(*, env: Mapping[str, str], command: Iterable[str]) -> CycleCommandPlan:
    return CycleCommandPlan(env=dict(env), command=tuple(command))
