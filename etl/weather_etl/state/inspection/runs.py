"""Read-only run status reports for ETL artifacts."""

from __future__ import annotations

from typing import Any

from ...storage.base import UriStore
from ..artifacts.repository import ArtifactRepository
from ..runs.ids import validate_run_id
from .lifecycle import inspect_run_lifecycle

RUNS_SCHEMA = "weather-map.etl-operator-runs"
STATUS_SCHEMA = "weather-map.etl-operator-status"
SCHEMA_VERSION = 2


def runs_report(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
) -> dict[str, Any]:
    """Return read-only status for all known runs of one dataset cycle."""

    run_ids = sorted(artifact_repo.list_run_ids(dataset_id=dataset_id, cycle=cycle), reverse=True)
    runs = [
        inspect_run_lifecycle(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        ).to_operator_run_dict()
        for run_id in run_ids
    ]
    return {
        "schema": RUNS_SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_count": len(runs),
        "runs": runs,
    }


def status_report(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str | None = None,
) -> dict[str, Any]:
    """Return read-only operator status for one selected run."""

    run_ids = sorted(artifact_repo.list_run_ids(dataset_id=dataset_id, cycle=cycle), reverse=True)
    explicit_run_id = validate_run_id(run_id) if run_id is not None else None
    selected_run_id = explicit_run_id
    ambiguous = False
    warnings: list[str] = []

    if selected_run_id is None:
        if run_ids:
            selected_run_id = run_ids[0]
            ambiguous = len(run_ids) > 1
            if ambiguous:
                warnings.append("multiple runs exist; publishing requires an explicit run id")
        else:
            return _status_report_envelope(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=None,
                state="not_found",
                stage=None,
                ambiguous=False,
                run_count=0,
                warnings=[],
                run=None,
            )
    elif selected_run_id not in run_ids:
        return _status_report_envelope(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=selected_run_id,
            state="not_found",
            stage=None,
            ambiguous=False,
            run_count=len(run_ids),
            warnings=[f"run id was not found under runs/{dataset_id}/{cycle}/{selected_run_id}/"],
            run=None,
        )

    run = inspect_run_lifecycle(
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=selected_run_id,
    ).to_operator_run_dict()
    return _status_report_envelope(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=selected_run_id,
        state=str(run["state"]),
        stage=str(run["stage"]),
        ambiguous=ambiguous,
        run_count=len(run_ids),
        warnings=warnings,
        run=run,
    )


def _status_report_envelope(
    *,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    state: str,
    stage: str | None,
    ambiguous: bool,
    run_count: int,
    warnings: list[str],
    run: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "schema": STATUS_SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": run_id,
        "state": state,
        "stage": stage,
        "ambiguous": ambiguous,
        "run_count": run_count,
        "warnings": warnings,
        "run": run,
    }
