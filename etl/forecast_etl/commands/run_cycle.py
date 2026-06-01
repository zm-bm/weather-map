"""Run-hour and run-cycle orchestration."""

from __future__ import annotations

from functools import partial
from multiprocessing import Pool
from traceback import format_exc
from typing import Iterable

from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec, IconDwdSourceConfig, ModelConfig, PipelineConfig
from ..cycles import parse_cycle
from ..proc import RunFn, make_runner
from ..run_metadata import RunMetadata, RunSnapshot, run_metadata_from_env
from ..runtime import ExecutionContext
from ..storage.base import UriStore
from ..storage.routing import make_store
from .publish_cycle import publish_cycle
from .run_hour import run_process_hour

HourTask = tuple[
    ExecutionContext,
    ModelConfig,
    dict[str, ArtifactSpec],
    tuple[str, ...],
    str,
    str,
    str,
    str | None,
    RunSnapshot,
]


class RunCycleTaskError(RuntimeError):
    """Pickle-safe wrapper for child process failures with hour context."""


def run_cycle(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    run_id: str,
    artifact_ids: Iterable[str] | None = None,
    procs: int | None = None,
    publish: bool,
    pipeline_config: PipelineConfig | None = None,
    store: UriStore | None = None,
    run: RunFn | None = None,
    run_metadata: RunMetadata | None = None,
    run_snapshot: RunSnapshot | None = None,
) -> None:
    """Process every configured forecast hour and optionally publish once."""

    snapshot = run_snapshot or RunSnapshot(
        metadata=run_metadata or run_metadata_from_env(config_digest="unknown"),
        pipeline_config={},
        forecast_catalog={},
    )
    tasks = build_run_cycle_tasks(
        model=model,
        ctx=ctx,
        cycle=cycle,
        run_id=run_id,
        artifact_ids=artifact_ids,
        run_snapshot=snapshot,
    )
    process_count = int(procs) if procs is not None else default_run_cycle_procs(model)
    if process_count != 1 and run is not None:
        raise SystemExit("Injected command runner for run-cycle requires --procs 1")
    try:
        if process_count == 1:
            resolved_store = store if store is not None else make_store()
            resolved_run = run if run is not None else make_runner()
            for task in tasks:
                run_cycle_one(task, store=resolved_store, run=resolved_run)
        else:
            worker = run_cycle_one if store is None else partial(run_cycle_one, store=store)
            with Pool(processes=None if process_count <= 0 else process_count) as pool:
                for _ in pool.imap_unordered(worker, tasks):
                    pass
    except RunCycleTaskError as exc:
        raise SystemExit(str(exc)) from None

    if publish:
        publish_cycle(
            ctx=ctx,
            model=model,
            cycle=cycle,
            run_id=run_id,
            pipeline_config=pipeline_config,
            forecast_catalog=snapshot.forecast_catalog,
            store=store,
        )


def run_cycle_one(payload: HourTask, *, store: UriStore | None = None, run: RunFn | None = None) -> None:
    """Run one serialized cycle task inside the current process."""

    ctx, model, artifact_specs, artifact_ids, cycle, run_id, fhour, source_uri, run_snapshot = payload
    resolved_store = store if store is not None else make_store()
    artifact_repo = ArtifactRepository.for_root(store=resolved_store, artifact_root_uri=ctx.artifact_root_uri)
    resolved_run = run if run is not None else make_runner()
    try:
        run_process_hour(
            ctx=ctx,
            model=model,
            cycle=cycle,
            run_id=run_id,
            fhour=fhour,
            source_uri=source_uri,
            artifact_ids=artifact_ids,
            artifact_specs=artifact_specs,
            store=resolved_store,
            artifact_repo=artifact_repo,
            run=resolved_run,
            run_snapshot=run_snapshot,
        )
    except KeyboardInterrupt:
        raise
    except BaseException as exc:
        raise RunCycleTaskError(
            f"Failed processing model={ctx.model_id} cycle={cycle} fhour={fhour}: {exc}\n"
            f"{format_exc()}"
        ) from None


def build_run_cycle_tasks(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    run_id: str,
    artifact_ids: Iterable[str] | None = None,
    run_metadata: RunMetadata | None = None,
    run_snapshot: RunSnapshot | None = None,
) -> list[HourTask]:
    """Build pickle-friendly per-hour tasks for local multiprocessing."""

    parse_cycle(cycle)
    snapshot = run_snapshot or RunSnapshot(
        metadata=run_metadata or run_metadata_from_env(config_digest="unknown"),
        pipeline_config={},
        forecast_catalog={},
    )
    fhours = model.workload.forecast_hours
    resolved_artifact_ids = tuple(artifact_ids or model.workload.artifacts or ())
    tasks: list[HourTask] = []

    for fhour in fhours:
        tasks.append((ctx, model, model.artifacts, resolved_artifact_ids, cycle, run_id, fhour, None, snapshot))

    return tasks


def default_run_cycle_procs(model: ModelConfig) -> int:
    """Return the default local process count for a model source type."""

    if isinstance(model.source, IconDwdSourceConfig):
        return 1
    return 4
