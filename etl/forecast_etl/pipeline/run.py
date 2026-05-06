"""Run-hour and run-cycle orchestration."""

from __future__ import annotations

from multiprocessing import Pool
from traceback import format_exc

from ..config.schema import (
    SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL,
    ExecutionContext,
    ModelConfig,
    ProductSpec,
)
from ..manifest.publish import run_publish
from ..sources.gfs_layout import parse_cycle
from ..worker import run_process_hour

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


def publish_cycle(*, ctx: ExecutionContext, model: ModelConfig, cycle: str) -> None:
    """Publish the manifest for a processed model cycle."""

    run_publish(
        ctx=ctx,
        cycle=cycle,
        model_label=model.label,
        product_ids=model.workload.products,
        products=model.products,
        product_groups=model.product_groups,
    )


def run_hour(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    fhour: str,
    source_uri: str | None,
    publish: bool,
) -> None:
    """Process one forecast hour and optionally publish the cycle."""

    run_process_hour(
        ctx=ctx,
        model=model,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        product_ids=model.workload.products,
        products=model.products,
    )
    if publish:
        publish_cycle(ctx=ctx, model=model, cycle=cycle)


def run_cycle(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    procs: int | None = None,
    publish: bool,
) -> None:
    """Process every configured forecast hour and optionally publish once."""

    tasks = build_run_cycle_tasks(model=model, ctx=ctx, cycle=cycle)
    process_count = int(procs) if procs is not None else default_run_cycle_procs(model)
    try:
        if process_count == 1:
            for task in tasks:
                run_cycle_one(task)
        else:
            with Pool(processes=None if process_count <= 0 else process_count) as pool:
                for _ in pool.imap_unordered(run_cycle_one, tasks):
                    pass
    except RunCycleTaskError as exc:
        raise SystemExit(str(exc)) from None

    if publish:
        publish_cycle(ctx=ctx, model=model, cycle=cycle)


def run_cycle_one(payload: HourTask) -> None:
    """Run one serialized cycle task inside the current process."""

    ctx, model, products, product_ids, cycle, fhour, source_uri = payload
    try:
        run_process_hour(
            ctx=ctx,
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri=source_uri,
            product_ids=product_ids,
            products=products,
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

    if model.source.type == SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
        return 1
    return 4
