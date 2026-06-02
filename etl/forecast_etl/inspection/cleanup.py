"""Read-only cleanup candidate classification for run-first ETL artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

from ..artifacts.repository import ArtifactRepository
from ..run_ids import validate_run_id
from ..storage.base import UriObject, UriStore
from .runs import runs_report

CLEANUP_SCHEMA = "weather-map.etl-cleanup-candidates"
SCHEMA_VERSION = 1

FAILED_OR_INCOMPLETE_RETENTION_HOURS = 24.0
UNPROMOTED_RETENTION_HOURS = 72.0
PUBLISHED_SUPERSEDED_RETENTION_HOURS = 336.0


def cleanup_runs_report(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return cleanup candidates for run-first ETL attempts without deleting objects."""

    resolved_now = _utc(now or datetime.now(timezone.utc))
    cycles = (cycle,) if cycle is not None else tuple(sorted(artifact_repo.list_run_cycles(dataset_id=dataset_id), reverse=True))
    runs: list[dict[str, Any]] = []
    for run_cycle in cycles:
        run_statuses = runs_report(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=run_cycle,
        )["runs"]
        for run in run_statuses:
            runs.append(
                _cleanup_entry(
                    artifact_repo=artifact_repo,
                    dataset_id=dataset_id,
                    cycle=run_cycle,
                    run=run,
                    now=resolved_now,
                )
            )
    return {
        "schema": CLEANUP_SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "mode": "dry-run",
        "candidate_count": sum(1 for run in runs if run["candidate"]),
        "protected_count": sum(1 for run in runs if run["protected"]),
        "deleted_object_count": sum(int(run.get("deleted_object_count") or 0) for run in runs),
        "deleted_bytes": sum(int(run.get("deleted_bytes") or 0) for run in runs),
        "delete_error_count": sum(1 for run in runs if run.get("delete_error")),
        "runs": runs,
    }


def _cleanup_entry(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run: Mapping[str, Any],
    now: datetime,
) -> dict[str, Any]:
    run_id = validate_run_id(str(run["run_id"]))
    run_prefix = artifact_repo.paths.run_prefix_key(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    objects = artifact_repo.list_run_objects(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    age_hours = _age_hours(objects=objects, run_id=run_id, now=now)
    object_count, total_bytes, unknown_size_count = _object_totals(objects)
    state = _cleanup_state(run)
    protected, protection_reason = _protection_reason(run)
    threshold_hours = _threshold_hours(state=state, protected=protected)
    candidate = _is_candidate(protected=protected, age_hours=age_hours, threshold_hours=threshold_hours)
    reason = _reason(
        state=state,
        protected=protected,
        protection_reason=protection_reason,
        candidate=candidate,
        age_hours=age_hours,
        threshold_hours=threshold_hours,
    )
    return {
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": run_id,
        "state": state,
        "candidate": candidate,
        "protected": protected,
        "reason": reason,
        "age_hours": age_hours,
        "threshold_hours": threshold_hours,
        "object_count": object_count,
        "total_bytes": total_bytes,
        "unknown_size_count": unknown_size_count,
        "deleted": False,
        "deleted_object_count": 0,
        "deleted_bytes": 0,
        "delete_error": None,
        "run_prefix": run_prefix,
    }


def _cleanup_state(run: Mapping[str, Any]) -> str:
    if bool(run.get("current")) or bool(run.get("latest")):
        return "protected"
    validation = _mapping(run.get("validation"))
    published = _mapping(run.get("published"))
    if validation.get("status") == "failed":
        return "failed_validation"
    if published.get("status") == "present":
        return "published_superseded"
    if validation.get("status") == "passed":
        return "validated_unpromoted"
    if run.get("complete") is True:
        return "complete_unpromoted"
    state = run.get("state")
    return state if isinstance(state, str) and state else "unknown"


def _protection_reason(run: Mapping[str, Any]) -> tuple[bool, str | None]:
    reasons: list[str] = []
    if bool(run.get("latest")):
        reasons.append("dataset latest")
    if bool(run.get("current")):
        reasons.append("cycle current")
    if not reasons:
        return False, None
    return True, "protected: " + " and ".join(reasons)


def _threshold_hours(*, state: str, protected: bool) -> float | None:
    if protected:
        return None
    if state in {"missing_snapshot", "invalid_snapshot", "incomplete", "failed_validation", "unknown"}:
        return FAILED_OR_INCOMPLETE_RETENTION_HOURS
    if state in {"complete_unpromoted", "validated_unpromoted"}:
        return UNPROMOTED_RETENTION_HOURS
    if state == "published_superseded":
        return PUBLISHED_SUPERSEDED_RETENTION_HOURS
    return FAILED_OR_INCOMPLETE_RETENTION_HOURS


def _is_candidate(*, protected: bool, age_hours: float | None, threshold_hours: float | None) -> bool:
    return not protected and age_hours is not None and threshold_hours is not None and age_hours >= threshold_hours


def _reason(
    *,
    state: str,
    protected: bool,
    protection_reason: str | None,
    candidate: bool,
    age_hours: float | None,
    threshold_hours: float | None,
) -> str:
    if protected:
        return protection_reason or "protected"
    if age_hours is None:
        return f"not a candidate: age unavailable for {state}"
    if threshold_hours is None:
        return f"not a candidate: no cleanup threshold for {state}"
    if candidate:
        return f"{state} older than {threshold_hours:g}h"
    return f"not old enough: {state} age={age_hours:g}h threshold={threshold_hours:g}h"


def _object_totals(objects: list[UriObject]) -> tuple[int, int, int]:
    sizes = [obj.size for obj in objects]
    known_sizes = [size for size in sizes if isinstance(size, int)]
    return len(objects), sum(known_sizes), len(sizes) - len(known_sizes)


def _age_hours(*, objects: list[UriObject], run_id: str, now: datetime) -> float | None:
    newest = _newest_modified(objects) or _run_id_time(run_id)
    if newest is None:
        return None
    age = max(0.0, (now - newest).total_seconds() / 3600.0)
    return round(age, 3)


def _newest_modified(objects: list[UriObject]) -> datetime | None:
    modified = [_utc(obj.last_modified) for obj in objects if obj.last_modified is not None]
    return max(modified) if modified else None


def _run_id_time(run_id: str) -> datetime | None:
    try:
        parsed = datetime.strptime(validate_run_id(run_id).split("-", 1)[0], "%Y%m%dT%H%M%SZ")
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc)


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
