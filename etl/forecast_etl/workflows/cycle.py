"""Workflow functions for single-cycle ETL operations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from ..backfill import BackfillCheckResult, check_backfill_safety
from ..commands.publish_cycle import publish_cycle as publish_cycle_command
from ..commands.run_cycle import run_cycle as run_cycle_command
from ..commands.run_frame import run_frame as run_frame_command
from ..cycles import parse_cycle
from ..manifest.publish import PublishResult
from ..run_ids import generate_run_id, parse_run_id
from ..run_snapshots import LoadedRunSnapshot
from ..run_validation import RunValidationResult, validate_run
from ..runtime import execution_context_for_dataset
from .context import ApplicationContext


@dataclass(frozen=True)
class InitRunResult:
    run_id: str
    config_digest: str
    pipeline_config_uri: str
    forecast_catalog_uri: str
    snapshot: LoadedRunSnapshot


@dataclass(frozen=True)
class PublishWorkflowResult:
    ready: bool
    run_id: str | None
    message: str | None = None
    errors: tuple[str, ...] = ()
    publish_result: PublishResult | None = None


@dataclass(frozen=True)
class ValidateWorkflowResult:
    ready: bool
    passed: bool
    run_id: str | None
    message: str | None = None
    errors: tuple[str, ...] = ()
    validation_result: RunValidationResult | None = None


def init_run(*, app_context: ApplicationContext, dataset_id: str, cycle: str, run_id: str) -> InitRunResult:
    parse_cycle(cycle)
    parsed_run_id = parse_run_id(run_id)
    snapshot = app_context.ensure_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=parsed_run_id)
    return InitRunResult(
        run_id=snapshot.run_id,
        config_digest=snapshot.config_digest,
        pipeline_config_uri=snapshot.pipeline_config_uri,
        forecast_catalog_uri=snapshot.forecast_catalog_uri,
        snapshot=snapshot,
    )


def process_frame(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    source_uri: str | None,
    artifact_ids: Iterable[str] | None,
) -> None:
    parse_cycle(cycle)
    parsed_run_id = parse_run_id(run_id)
    runtime = app_context.resolve_dataset_runtime(dataset_id)
    run_snapshot = app_context.source_run_snapshot(runtime.loaded_config)
    resolved_artifact_ids = resolve_artifact_ids(runtime.dataset, artifact_ids)
    run_frame_command(
        model=runtime.dataset,
        ctx=runtime.execution_context,
        cycle=cycle,
        run_id=parsed_run_id,
        frame_id=frame_id,
        source_uri=source_uri,
        artifact_ids=resolved_artifact_ids,
        store=app_context.store,
        run_snapshot=run_snapshot,
    )


def process_cycle(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    artifact_ids: Iterable[str] | None,
    procs: int | None,
    publish: bool,
) -> str:
    parse_cycle(cycle)
    parsed_run_id = parse_run_id(run_id) if run_id else generate_run_id()
    runtime = app_context.resolve_dataset_runtime(dataset_id)
    run_snapshot = app_context.source_run_snapshot(runtime.loaded_config)
    loaded_run_snapshot = app_context.ensure_run_snapshot(
        dataset_id=runtime.dataset.id,
        cycle=cycle,
        run_id=parsed_run_id,
    )
    run_cycle_command(
        model=runtime.dataset,
        ctx=runtime.execution_context,
        cycle=cycle,
        run_id=parsed_run_id,
        artifact_ids=resolve_artifact_ids(runtime.dataset, artifact_ids),
        procs=procs,
        publish=publish,
        pipeline_config=runtime.pipeline_config,
        store=app_context.store,
        run_snapshot=run_snapshot,
        loaded_run_snapshot=loaded_run_snapshot,
    )
    return parsed_run_id


def resolve_artifact_ids(dataset, selected: Iterable[str] | None) -> tuple[str, ...]:
    workload_artifacts = tuple(dataset.workload.artifacts or ())
    if selected is None:
        return workload_artifacts

    requested = {artifact_id.strip() for artifact_id in selected if artifact_id.strip()}
    if not requested:
        raise SystemExit("--artifact requires at least one non-empty artifact id")

    unknown = sorted(requested - set(workload_artifacts))
    if unknown:
        raise SystemExit(
            f"Unknown artifact id(s) for dataset {dataset.id!r}: {unknown!r}; "
            f"configured artifacts: {list(workload_artifacts)!r}"
        )

    return tuple(artifact_id for artifact_id in workload_artifacts if artifact_id in requested)


def validate_cycle(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None = None,
) -> ValidateWorkflowResult:
    parse_cycle(cycle)
    parsed_required_run_id = parse_run_id(required_run_id) if required_run_id else None
    run_id, run_errors = app_context.select_run_id_for_cycle(
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=parsed_required_run_id,
    )
    if run_errors or run_id is None:
        return ValidateWorkflowResult(
            ready=False,
            passed=False,
            run_id=run_id,
            message=f"run selection failed for dataset_id={dataset_id} cycle={cycle}",
            errors=tuple(run_errors),
        )
    try:
        snapshot = app_context.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except FileNotFoundError as exc:
        return ValidateWorkflowResult(
            ready=False,
            passed=False,
            run_id=run_id,
            message=str(exc),
        )

    dataset = snapshot.loaded_config.config.dataset(dataset_id)
    result = validate_run(
        artifact_repo=app_context.artifact_repo,
        model=dataset,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return ValidateWorkflowResult(
        ready=True,
        passed=result.passed,
        run_id=run_id,
        validation_result=result,
        errors=tuple(result.errors),
    )


def publish_cycle(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None = None,
) -> PublishWorkflowResult:
    parse_cycle(cycle)
    parsed_required_run_id = parse_run_id(required_run_id) if required_run_id else None
    run_id, run_errors = app_context.select_run_id_for_cycle(
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=parsed_required_run_id,
    )
    if run_errors or run_id is None:
        return PublishWorkflowResult(
            ready=False,
            run_id=run_id,
            message=f"run selection failed for dataset_id={dataset_id} cycle={cycle}",
            errors=tuple(run_errors),
        )
    try:
        snapshot = app_context.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except FileNotFoundError as exc:
        return PublishWorkflowResult(ready=False, run_id=run_id, message=str(exc))

    cfg = snapshot.loaded_config.config
    dataset = cfg.dataset(dataset_id)
    result = publish_cycle_command(
        model=dataset,
        ctx=execution_context_for_dataset(dataset, app_context.artifact_root_uri),
        cycle=cycle,
        run_id=run_id,
        pipeline_config=cfg,
        forecast_catalog=snapshot.forecast_catalog,
        store=app_context.store,
    )
    return PublishWorkflowResult(
        ready=result.ready,
        run_id=run_id,
        publish_result=result,
        errors=tuple(result.missing_markers),
    )


def check_backfill(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    allow_backfill: bool = False,
) -> BackfillCheckResult:
    return check_backfill_safety(
        artifact_repo=app_context.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        allow_backfill=allow_backfill,
    )
