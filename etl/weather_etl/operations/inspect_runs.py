"""Run/status inspection operations."""

from __future__ import annotations

from typing import Any

from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..state.inspection.runs import runs_report, status_report
from ..state.runs.ids import parse_run_id


def inspect_runs(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
) -> dict[str, Any]:
    """Return known runs for one dataset cycle."""

    parse_cycle(cycle)
    return runs_report(
        artifact_repo=env.artifact_repo,
        store=env.store,
        dataset_id=dataset_id,
        cycle=cycle,
    )


def inspect_status(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Return operator status for one selected run."""

    parse_cycle(cycle)
    return status_report(
        artifact_repo=env.artifact_repo,
        store=env.store,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=parse_run_id(run_id) if run_id else None,
    )
