"""Read-only public manifest pointer diagnostics."""

from __future__ import annotations

from typing import Any, Mapping

from ..artifacts.repository import ArtifactRepository
from ..manifest.inspect import manifest_info_from_obj
from ..manifest.pointers import (
    CURRENT_POINTER_SCHEMA,
    LATEST_POINTER_SCHEMA,
    is_manifest_pointer,
    parse_manifest_pointer,
)
from ..uris import join_uri

POINTERS_SCHEMA = "weather-map.etl-operator-pointers"
SCHEMA_VERSION = 1


def pointers_report(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str | None = None,
) -> dict[str, Any]:
    """Return read-only diagnostics for public manifest pointers."""

    latest = inspect_pointer_alias(
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
        current = inspect_pointer_alias(
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


def cycle_pointer_state(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str) -> dict[str, Any]:
    """Return latest/current pointer diagnostics for one dataset cycle."""

    latest = inspect_pointer_alias(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        alias="latest",
        uri=artifact_repo.paths.manifest_latest_uri(dataset_id=dataset_id),
        expected_schema=LATEST_POINTER_SCHEMA,
        expected_cycle=None,
    )
    current = inspect_pointer_alias(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        alias="current",
        uri=artifact_repo.paths.cycle_current_pointer_uri(dataset_id=dataset_id, cycle=cycle),
        expected_schema=CURRENT_POINTER_SCHEMA,
        expected_cycle=cycle,
    )
    return {"latest": latest, "current": current}


def inspect_pointer_alias(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    alias: str,
    uri: str,
    expected_schema: str,
    expected_cycle: str | None,
) -> dict[str, Any]:
    """Inspect one public pointer alias without raising on malformed state."""

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


def pointer_matches(pointer: object, *, run_id: str) -> bool:
    """Return whether one inspected pointer validly targets a run."""

    return isinstance(pointer, Mapping) and pointer.get("run_id") == run_id and pointer.get("status") == "valid"


def pointer_match_status(pointer: object, *, run_id: str) -> str:
    """Return a stable human-readable pointer match status for one run."""

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
