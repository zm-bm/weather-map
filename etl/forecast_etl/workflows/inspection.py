"""Read-side workflow wrappers for operator inspection commands."""

from __future__ import annotations

from ..cleanup_candidates import cleanup_runs_report
from ..cycles import parse_cycle
from ..operator_status import pointers_report, runs_report, status_report
from ..run_ids import parse_run_id
from .context import ApplicationContext


def runs(*, app_context: ApplicationContext, model_id: str, cycle: str) -> dict:
    parse_cycle(cycle)
    return runs_report(
        artifact_repo=app_context.artifact_repo,
        store=app_context.store,
        model_id=model_id,
        cycle=cycle,
    )


def status(
    *,
    app_context: ApplicationContext,
    model_id: str,
    cycle: str,
    run_id: str | None = None,
) -> dict:
    parse_cycle(cycle)
    return status_report(
        artifact_repo=app_context.artifact_repo,
        store=app_context.store,
        model_id=model_id,
        cycle=cycle,
        run_id=parse_run_id(run_id) if run_id else None,
    )


def pointers(*, app_context: ApplicationContext, model_id: str, cycle: str | None = None) -> dict:
    if cycle is not None:
        parse_cycle(cycle)
    return pointers_report(
        artifact_repo=app_context.artifact_repo,
        model_id=model_id,
        cycle=cycle,
    )


def cleanup_runs(
    *,
    app_context: ApplicationContext,
    model_id: str,
    cycle: str | None = None,
    delete_candidates: bool = False,
) -> dict:
    if cycle is not None:
        parse_cycle(cycle)
    return cleanup_runs_report(
        artifact_repo=app_context.artifact_repo,
        store=app_context.store,
        model_id=model_id,
        cycle=cycle,
        delete_candidates=delete_candidates,
    )
