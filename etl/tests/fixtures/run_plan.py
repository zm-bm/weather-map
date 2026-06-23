from __future__ import annotations

from weather_etl.workers.launch import WorkerLaunchRecord, WorkerLaunchSummary
from weather_etl.workers.plan import FrameStatePlan, RunCommandPlan, RunPlan
from weather_etl.workers.spec import FrameWorkerSpec

from tests.fixtures.artifacts import DEFAULT_PRODUCT_CONFIG_DIGEST, DEFAULT_RUN_ID

DEFAULT_CYCLE = "2026021300"


def frame_worker(
    frame_id: str = "000",
    *,
    dataset_id: str = "gfs",
    env: dict[str, str] | None = None,
    command: tuple[str, ...] | None = None,
    source_uri: str | None = None,
) -> FrameWorkerSpec:
    return FrameWorkerSpec(
        frame_id=frame_id,
        env=env
        if env is not None
        else {
            "DATASET_ID": dataset_id,
            "FRAME_ID": frame_id,
        },
        command=command
        if command is not None
        else ("weather-etl", "run-frame", "--dataset-id", dataset_id, "--frame-id", frame_id),
        source_uri=source_uri,
    )


def frame_state(
    frame_id: str = "000",
    state: str = "pending",
    *,
    source_uri: str | None = None,
    worker_spec_hash: str = "abc123",
) -> FrameStatePlan:
    complete = state == "complete"
    return FrameStatePlan(
        frame_id=frame_id,
        state=state,
        eligible_for_submission=state in {"pending", "missing"},
        expected_marker_count=1,
        observed_marker_count=1 if complete else 0,
        missing_marker_count=0 if complete else 1,
        missing_markers=(),
        errors=(),
        claim=None,
        source_uri=source_uri,
        worker_spec_hash=worker_spec_hash,
    )


def run_plan(
    *,
    dataset_id: str = "gfs",
    cycle: str = DEFAULT_CYCLE,
    run_id: str = DEFAULT_RUN_ID,
    workers: tuple[FrameWorkerSpec, ...] = (),
    frame_states: tuple[FrameStatePlan, ...] | None = None,
    frame_ids: tuple[str, ...] | None = None,
    artifact_ids: tuple[str, ...] = ("tmp_surface",),
    artifact_root_uri: str = "file:///artifacts",
    source_pipeline_uri: str = "file:///config/pipeline.json",
    source_catalog_uri: str = "file:///config/catalog.json",
    product_config_digest: str = DEFAULT_PRODUCT_CONFIG_DIGEST,
    pipeline_uri: str | None = None,
    catalog_uri: str | None = None,
    snapshot_exists: bool = True,
    resume: bool = True,
    publish: bool = True,
) -> RunPlan:
    resolved_frame_states = frame_states if frame_states is not None else ()
    resolved_frame_ids = (
        frame_ids
        if frame_ids is not None
        else tuple(state.frame_id for state in resolved_frame_states) or tuple(worker.frame_id for worker in workers)
    )
    return RunPlan(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        artifact_root_uri=artifact_root_uri,
        source_pipeline_uri=source_pipeline_uri,
        source_catalog_uri=source_catalog_uri,
        product_config_digest=product_config_digest,
        pipeline_uri=pipeline_uri or f"{artifact_root_uri}/runs/{dataset_id}/{cycle}/{run_id}/config/pipeline.json",
        catalog_uri=catalog_uri or f"{artifact_root_uri}/runs/{dataset_id}/{cycle}/{run_id}/config/catalog.json",
        snapshot_exists=snapshot_exists,
        resume=resume,
        frame_ids=resolved_frame_ids,
        artifact_ids=artifact_ids,
        workers=workers,
        frame_states=resolved_frame_states,
        validation=RunCommandPlan(env={}, command=("weather-etl", "validate-run")),
        publish=RunCommandPlan(env={}, command=("weather-etl", "publish-run")) if publish else None,
    )


def launch_summary(
    workers: tuple[FrameWorkerSpec, ...],
    *,
    failed: bool = False,
    started: bool | None = None,
) -> WorkerLaunchSummary:
    return WorkerLaunchSummary(
        records=tuple(
            WorkerLaunchRecord(
                worker=worker,
                started=not failed if started is None else started,
                failed=failed,
            )
            for worker in workers
        )
    )
