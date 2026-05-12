"""Run-hour and run-cycle orchestration."""

from __future__ import annotations

from functools import partial
from multiprocessing import Pool
from traceback import format_exc

from ..artifacts.repository import ArtifactRepository
from ..config.resolved import IconDwdSourceConfig, ModelConfig, ProductSpec
from ..cycles import parse_cycle
from ..proc import RunFn, make_runner
from ..runtime import ExecutionContext
from ..storage.base import UriStore
from ..storage.routing import make_store
from .publish_cycle import publish_cycle
from .run_hour import run_process_hour

HourTask = tuple[
    ExecutionContext,
    ModelConfig,
    dict[str, ProductSpec],
    tuple[str, ...],
    str,
    str,
    str | None,
]


class RunCycleTaskError(RuntimeError):
    """Pickle-safe wrapper for child process failures with hour context."""


def run_cycle(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    procs: int | None = None,
    publish: bool,
    store: UriStore | None = None,
    run: RunFn | None = None,
) -> None:
    """Process every configured forecast hour and optionally publish once."""

    tasks = build_run_cycle_tasks(model=model, ctx=ctx, cycle=cycle)
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
        publish_cycle(ctx=ctx, model=model, cycle=cycle, store=store)


def run_cycle_one(payload: HourTask, *, store: UriStore | None = None, run: RunFn | None = None) -> None:
    """Run one serialized cycle task inside the current process."""

    ctx, model, products, product_ids, cycle, fhour, source_uri = payload
    resolved_store = store if store is not None else make_store()
    artifacts = ArtifactRepository.for_root(store=resolved_store, artifact_root_uri=ctx.artifact_root_uri)
    resolved_run = run if run is not None else make_runner()
    try:
        run_process_hour(
            ctx=ctx,
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri=source_uri,
            product_ids=product_ids,
            products=products,
            store=resolved_store,
            artifacts=artifacts,
            run=resolved_run,
        )
    except KeyboardInterrupt:
        raise
    except BaseException as exc:
        raise RunCycleTaskError(
            f"Failed processing model={ctx.model_id} cycle={cycle} fhour={fhour}: {exc}\n"
            f"{format_exc()}"
        ) from None


def build_run_cycle_tasks(*, model: ModelConfig, ctx: ExecutionContext, cycle: str) -> list[HourTask]:
    """Build pickle-friendly per-hour tasks for local multiprocessing."""

    parse_cycle(cycle)
    fhours = model.workload.forecast_hours
    product_ids = tuple(model.workload.products or ())
    tasks: list[HourTask] = []

    for fhour in fhours:
        tasks.append((ctx, model, model.products, product_ids, cycle, fhour, None))

    return tasks


def default_run_cycle_procs(model: ModelConfig) -> int:
    """Return the default local process count for a model source type."""

    if isinstance(model.source, IconDwdSourceConfig):
        return 1
    return 4
