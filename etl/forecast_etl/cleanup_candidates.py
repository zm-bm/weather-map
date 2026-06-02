"""Operator cleanup reports and optional deletion for run-first ETL artifacts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .artifacts.repository import ArtifactRepository
from .inspection.cleanup import (
    CLEANUP_SCHEMA,
    FAILED_OR_INCOMPLETE_RETENTION_HOURS,
    PUBLISHED_SUPERSEDED_RETENTION_HOURS,
    SCHEMA_VERSION,
    UNPROMOTED_RETENTION_HOURS,
)
from .inspection.cleanup import (
    cleanup_runs_report as classify_cleanup_runs,
)
from .storage.base import UriStore

__all__ = [
    "CLEANUP_SCHEMA",
    "FAILED_OR_INCOMPLETE_RETENTION_HOURS",
    "PUBLISHED_SUPERSEDED_RETENTION_HOURS",
    "SCHEMA_VERSION",
    "UNPROMOTED_RETENTION_HOURS",
    "cleanup_runs_report",
]


def cleanup_runs_report(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str | None = None,
    now: datetime | None = None,
    delete_candidates: bool = False,
) -> dict[str, Any]:
    """Return cleanup candidates and optionally delete candidate run prefixes."""

    report = classify_cleanup_runs(
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset_id,
        cycle=cycle,
        now=now,
    )
    if delete_candidates:
        _delete_candidates(artifact_repo=artifact_repo, runs=report["runs"])
        report["mode"] = "delete"
        report["deleted_object_count"] = sum(int(run.get("deleted_object_count") or 0) for run in report["runs"])
        report["deleted_bytes"] = sum(int(run.get("deleted_bytes") or 0) for run in report["runs"])
        report["delete_error_count"] = sum(1 for run in report["runs"] if run.get("delete_error"))
    return report


def _delete_candidates(*, artifact_repo: ArtifactRepository, runs: list[dict[str, Any]]) -> None:
    for run in runs:
        if not bool(run.get("candidate")):
            continue
        try:
            deleted = artifact_repo.delete_run_objects(
                dataset_id=str(run["dataset_id"]),
                cycle=str(run["cycle"]),
                run_id=str(run["run_id"]),
            )
        except (Exception, SystemExit) as exc:
            run["delete_error"] = str(exc)
            continue
        known_sizes = [obj.size for obj in deleted if isinstance(obj.size, int)]
        run["deleted"] = True
        run["deleted_object_count"] = len(deleted)
        run["deleted_bytes"] = sum(known_sizes)
