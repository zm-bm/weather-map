"""Read-only operator status reports for ETL runs and manifest pointers."""

from __future__ import annotations

from typing import Any, Mapping

from .artifacts.repository import ArtifactRepository
from .artifacts.status import summarize_cycle_progress
from .manifest.inspect import manifest_info_from_obj
from .manifest.pointers import (
    CURRENT_POINTER_SCHEMA,
    LATEST_POINTER_SCHEMA,
    is_manifest_pointer,
    parse_manifest_pointer,
)
from .run_ids import validate_run_id
from .run_snapshots import LoadedRunSnapshot, load_run_snapshot
from .storage.base import UriStore
from .uris import join_uri

RUNS_SCHEMA = "weather-map.etl-operator-runs"
STATUS_SCHEMA = "weather-map.etl-operator-status"
POINTERS_SCHEMA = "weather-map.etl-operator-pointers"
SCHEMA_VERSION = 1


def runs_report(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
) -> dict[str, Any]:
    """Return read-only status for all known runs of one dataset cycle."""

    pointer_state = _cycle_pointer_state(artifact_repo=artifact_repo, dataset_id=dataset_id, cycle=cycle)
    run_ids = sorted(artifact_repo.list_run_ids(dataset_id=dataset_id, cycle=cycle), reverse=True)
    runs = [
        _run_summary(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            pointer_state=pointer_state,
        )
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
            return {
                "schema": STATUS_SCHEMA,
                "schema_version": SCHEMA_VERSION,
                "dataset_id": dataset_id,
                "cycle": cycle,
                "run_id": None,
                "state": "not_found",
                "ambiguous": False,
                "run_count": 0,
                "warnings": [],
                "run": None,
            }
    elif selected_run_id not in run_ids:
        return {
            "schema": STATUS_SCHEMA,
            "schema_version": SCHEMA_VERSION,
            "dataset_id": dataset_id,
            "cycle": cycle,
            "run_id": selected_run_id,
            "state": "not_found",
            "ambiguous": False,
            "run_count": len(run_ids),
            "warnings": [f"run id was not found under runs/{dataset_id}/{cycle}/{selected_run_id}/"],
            "run": None,
        }

    pointer_state = _cycle_pointer_state(artifact_repo=artifact_repo, dataset_id=dataset_id, cycle=cycle)
    run = _run_summary(
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=selected_run_id,
        pointer_state=pointer_state,
    )
    return {
        "schema": STATUS_SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": selected_run_id,
        "state": run["state"],
        "ambiguous": ambiguous,
        "run_count": len(run_ids),
        "warnings": warnings,
        "run": run,
    }


def pointers_report(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str | None = None,
) -> dict[str, Any]:
    """Return read-only diagnostics for public manifest pointers."""

    latest = _inspect_pointer_alias(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        alias="latest",
        uri=artifact_repo.paths.manifest_latest_uri(dataset_id=dataset_id),
        expected_schema=LATEST_POINTER_SCHEMA,
        expected_cycle=None,
    )
    current_cycle = cycle
    if current_cycle is None and latest.get("status") == "valid":
        latest_cycle = latest.get("cycle")
        if isinstance(latest_cycle, str):
            current_cycle = latest_cycle

    current = None
    if current_cycle is not None:
        current = _inspect_pointer_alias(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            alias="current",
            uri=artifact_repo.paths.cycle_current_pointer_uri(dataset_id=dataset_id, cycle=current_cycle),
            expected_schema=CURRENT_POINTER_SCHEMA,
            expected_cycle=current_cycle,
        )

    return {
        "schema": POINTERS_SCHEMA,
        "schema_version": SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": current_cycle,
        "latest": latest,
        "current": current,
    }


def _cycle_pointer_state(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str) -> dict[str, Any]:
    latest = _inspect_pointer_alias(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        alias="latest",
        uri=artifact_repo.paths.manifest_latest_uri(dataset_id=dataset_id),
        expected_schema=LATEST_POINTER_SCHEMA,
        expected_cycle=None,
    )
    current = _inspect_pointer_alias(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        alias="current",
        uri=artifact_repo.paths.cycle_current_pointer_uri(dataset_id=dataset_id, cycle=cycle),
        expected_schema=CURRENT_POINTER_SCHEMA,
        expected_cycle=cycle,
    )
    return {"latest": latest, "current": current}


def _run_summary(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
    pointer_state: Mapping[str, Any],
) -> dict[str, Any]:
    snapshot = _snapshot_summary(
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )
    markers = _marker_summary(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot["_snapshot"],
    )
    validation = _validation_summary(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )
    published = _published_summary(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )
    manifests = _manifest_summary(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )
    state = _run_state(snapshot=snapshot, markers=markers)
    summary = {
        "run_id": run_id,
        "state": state,
        "complete": markers["complete"],
        "snapshot": _public_snapshot_summary(snapshot),
        "markers": markers,
        "validation": validation,
        "published": published,
        "manifests": manifests,
        "pointers": {
            "cycle_current": _pointer_match_status(pointer_state.get("current"), run_id=run_id),
            "dataset_latest": _pointer_match_status(pointer_state.get("latest"), run_id=run_id),
        },
        "current": _pointer_matches(pointer_state.get("current"), run_id=run_id),
        "latest": _pointer_matches(pointer_state.get("latest"), run_id=run_id),
        "publication_ready": _publication_ready(markers=markers, validation=validation),
        "diagnostics": _run_diagnostics(
            snapshot=snapshot,
            markers=markers,
            validation=validation,
            published=published,
            pointer_state=pointer_state,
            run_id=run_id,
        ),
    }
    return summary


def _snapshot_summary(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> dict[str, Any]:
    run_uri = artifact_repo.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    if not artifact_repo.store.exists(uri=run_uri):
        return {
            "status": "missing",
            "path": artifact_repo.paths.relative_key(run_uri),
            "error": f"missing run metadata snapshot: {run_uri}",
            "_snapshot": None,
        }
    try:
        snapshot = load_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    except (Exception, SystemExit) as exc:
        return {
            "status": "invalid",
            "path": artifact_repo.paths.relative_key(run_uri),
            "error": str(exc),
            "_snapshot": None,
        }
    return {
        "status": "valid",
        "path": artifact_repo.paths.relative_key(run_uri),
        "config_digest": snapshot.config_digest,
        "pipeline_config_uri": snapshot.pipeline_config_uri,
        "forecast_catalog_uri": snapshot.forecast_catalog_uri,
        "error": None,
        "_snapshot": snapshot,
    }


def _public_snapshot_summary(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in snapshot.items()
        if key != "_snapshot"
    }


def _marker_summary(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    snapshot: LoadedRunSnapshot | None,
) -> dict[str, Any]:
    if snapshot is None:
        existing = artifact_repo.list_success_marker_uris(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return {
            "expected": None,
            "completed": len(existing),
            "missing": None,
            "missing_sample": [],
            "invalid_sample": [],
            "complete": None,
            "last_progress_at": None,
        }

    model = snapshot.loaded_config.config.dataset(dataset_id)
    progress = summarize_cycle_progress(
        artifact_root_uri=artifact_repo.paths.artifact_root_uri,
        dataset_id=dataset_id,
        cycle=cycle,
        artifact_ids=model.workload.artifacts,
        frames=model.workload.frames,
        objects=artifact_repo.list_cycle_run_objects(dataset_id=dataset_id, cycle=cycle),
        read_json=artifact_repo.read_json_uri,
        run_id=run_id,
        manifest_present=artifact_repo.public_run_manifest_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
    )
    return {
        "expected": progress.expected_markers,
        "completed": progress.found_markers,
        "missing": progress.missing_markers,
        "missing_sample": list(progress.missing_sample),
        "invalid_sample": list(progress.invalid_marker_sample),
        "complete": progress.complete,
        "last_progress_at": _iso_or_none(progress.last_progress_at),
    }


def _validation_summary(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    uri = artifact_repo.paths.validation_report_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.validation_report_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return {"status": "missing", "path": path, "errors": 0, "warnings": 0, "error": None}
    try:
        report = artifact_repo.read_validation_report(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        return {"status": "invalid", "path": path, "errors": None, "warnings": None, "error": str(exc)}
    status = report.get("status")
    if status not in {"passed", "failed"}:
        return {
            "status": "invalid",
            "path": path,
            "errors": None,
            "warnings": None,
            "error": f"unexpected validation status: {status!r}",
        }
    errors = report.get("errors")
    warnings = report.get("warnings")
    return {
        "status": status,
        "path": path,
        "errors": len(errors) if isinstance(errors, list) else None,
        "warnings": len(warnings) if isinstance(warnings, list) else None,
        "generated_at": report.get("generated_at"),
        "payload_check_mode": report.get("payload_check_mode"),
        "error": None,
    }


def _published_summary(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    uri = artifact_repo.paths.published_marker_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.published_marker_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return {"status": "missing", "path": path, "error": None}
    try:
        marker = artifact_repo.read_published_marker(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        return {"status": "invalid", "path": path, "error": str(exc)}
    return {
        "status": "present",
        "path": path,
        "generated_at": marker.generated_at,
        "revision": marker.revision,
        "manifest_uri": marker.manifest_uri,
        "error": None,
    }


def _manifest_summary(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    internal_uri = artifact_repo.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    public_uri = artifact_repo.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    return {
        "internal_run_manifest_path": artifact_repo.paths.relative_key(internal_uri),
        "internal_run_manifest_exists": artifact_repo.run_manifest_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
        "public_run_manifest_path": artifact_repo.paths.relative_key(public_uri),
        "public_run_manifest_exists": artifact_repo.public_run_manifest_exists(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        ),
    }


def _run_state(*, snapshot: Mapping[str, Any], markers: Mapping[str, Any]) -> str:
    if snapshot.get("status") == "missing":
        return "missing_snapshot"
    if snapshot.get("status") == "invalid":
        return "invalid_snapshot"
    if markers.get("complete") is True:
        return "complete"
    return "incomplete"


def _publication_ready(*, markers: Mapping[str, Any], validation: Mapping[str, Any]) -> bool:
    return markers.get("complete") is True and validation.get("status") == "passed"


def _run_diagnostics(
    *,
    snapshot: Mapping[str, Any],
    markers: Mapping[str, Any],
    validation: Mapping[str, Any],
    published: Mapping[str, Any],
    pointer_state: Mapping[str, Any],
    run_id: str,
) -> list[str]:
    diagnostics: list[str] = []
    if snapshot.get("status") != "valid":
        diagnostics.append(str(snapshot.get("error") or f"snapshot status is {snapshot.get('status')}"))
    if markers.get("complete") is False:
        diagnostics.append(f"missing markers: {markers.get('missing')}")
    if validation.get("status") != "passed":
        diagnostics.append(f"validation status is {validation.get('status')}")
    if published.get("status") != "present":
        diagnostics.append(f"published marker status is {published.get('status')}")
    for label, pointer in (("cycle current", pointer_state.get("current")), ("dataset latest", pointer_state.get("latest"))):
        match_status = _pointer_match_status(pointer, run_id=run_id)
        if match_status not in {"matches", "missing"}:
            diagnostics.append(f"{label} pointer status for this run is {match_status}")
    return diagnostics


def _inspect_pointer_alias(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    alias: str,
    uri: str,
    expected_schema: str,
    expected_cycle: str | None,
) -> dict[str, Any]:
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.store.exists(uri=uri):
        return _pointer_base(alias=alias, uri=uri, path=path, status="missing", kind="missing")
    try:
        raw = artifact_repo.read_json_uri(uri)
    except (Exception, SystemExit) as exc:
        return _pointer_base(
            alias=alias,
            uri=uri,
            path=path,
            status="malformed",
            kind="invalid",
            diagnostics=[f"unable to read JSON: {exc}"],
        )

    if is_manifest_pointer(raw):
        return _inspect_pointer_object(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            alias=alias,
            uri=uri,
            path=path,
            raw=raw,
            expected_schema=expected_schema,
            expected_cycle=expected_cycle,
        )

    return _pointer_base(
        alias=alias,
        uri=uri,
        path=path,
        status="malformed",
        kind="unknown",
        diagnostics=["alias is not a valid manifest pointer"],
    )


def _inspect_pointer_object(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    alias: str,
    uri: str,
    path: str,
    raw: Mapping[str, Any],
    expected_schema: str,
    expected_cycle: str | None,
) -> dict[str, Any]:
    try:
        pointer = parse_manifest_pointer(raw, expected_schema=expected_schema, uri=uri)
    except (Exception, SystemExit) as exc:
        return _pointer_base(
            alias=alias,
            uri=uri,
            path=path,
            status="malformed",
            kind="pointer",
            diagnostics=[str(exc)],
        )

    diagnostics: list[str] = []
    status = "valid"
    if pointer.dataset_id != dataset_id:
        status = "malformed"
        diagnostics.append(f"pointer dataset_id mismatch: expected={dataset_id!r} found={pointer.dataset_id!r}")
    if expected_cycle is not None and pointer.cycle != expected_cycle:
        status = "stale"
        diagnostics.append(f"pointer cycle mismatch: expected={expected_cycle!r} found={pointer.cycle!r}")

    target_uri = join_uri(artifact_repo.paths.artifact_root_uri, [pointer.manifest_path])
    target_status, target_diagnostics = _pointer_target_status(
        artifact_repo=artifact_repo,
        target_uri=target_uri,
        pointer_cycle=pointer.cycle,
        pointer_run_id=pointer.run_id,
        pointer_revision=pointer.revision,
    )
    diagnostics.extend(target_diagnostics)
    if status == "valid" and target_status != "valid":
        status = target_status

    return {
        **_pointer_base(alias=alias, uri=uri, path=path, status=status, kind="pointer", diagnostics=diagnostics),
        "schema": pointer.schema_name,
        "cycle": pointer.cycle,
        "run_id": pointer.run_id,
        "revision": pointer.revision,
        "generated_at": pointer.generated_at,
        "manifest_path": pointer.manifest_path,
        "target_exists": target_status != "target_missing",
        "target_valid": target_status == "valid",
    }


def _pointer_target_status(
    *,
    artifact_repo: ArtifactRepository,
    target_uri: str,
    pointer_cycle: str,
    pointer_run_id: str,
    pointer_revision: str,
) -> tuple[str, list[str]]:
    try:
        target = artifact_repo.read_json_uri(target_uri)
    except FileNotFoundError:
        return "target_missing", [f"pointer target is missing: {target_uri}"]
    except (Exception, SystemExit) as exc:
        return "target_invalid", [f"unable to read pointer target: {target_uri}: {exc}"]

    info = manifest_info_from_obj(target)
    if info is None:
        return "target_invalid", [f"pointer target has no valid run metadata: {target_uri}"]
    if info.cycle != pointer_cycle or info.run_id != pointer_run_id or info.revision != pointer_revision:
        return (
            "target_mismatch",
            [
                "pointer target mismatch: "
                f"pointer=({pointer_cycle}, {pointer_run_id}, {pointer_revision}) "
                f"target=({info.cycle}, {info.run_id}, {info.revision}) uri={target_uri}"
            ],
        )
    return "valid", []


def _pointer_base(
    *,
    alias: str,
    uri: str,
    path: str,
    status: str,
    kind: str,
    diagnostics: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "alias": alias,
        "uri": uri,
        "path": path,
        "status": status,
        "kind": kind,
        "diagnostics": list(diagnostics or []),
    }


def _pointer_matches(pointer: object, *, run_id: str) -> bool:
    return isinstance(pointer, Mapping) and pointer.get("run_id") == run_id and pointer.get("status") == "valid"


def _pointer_match_status(pointer: object, *, run_id: str) -> str:
    if not isinstance(pointer, Mapping):
        return "unknown"
    status = pointer.get("status")
    if status == "missing":
        return "missing"
    if status != "valid":
        return str(status or "unknown")
    if pointer.get("run_id") == run_id:
        return "matches"
    return "different"


def _iso_or_none(value: object) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return None
