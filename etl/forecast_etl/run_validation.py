"""Run-scoped validation before public manifest publication."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from .artifacts.markers_schema import ArtifactSuccessMarker
from .artifacts.paths import WorkItem
from .artifacts.repository import ArtifactRepository
from .config.resolved import ArtifactSpec, DatasetConfig
from .run_snapshots import LoadedRunSnapshot

VALIDATION_SCHEMA = "weather-map.etl-run-validation"
VALIDATION_SCHEMA_VERSION = 1
PAYLOAD_CHECK_MODE = "marker_metadata_only"


@dataclass(frozen=True)
class RunValidationResult:
    """Outcome of validating one immutable ETL run."""

    passed: bool
    run_id: str
    report_uri: str
    report: dict[str, Any]
    errors: tuple[str, ...]
    warnings: tuple[str, ...]


def validate_run(
    *,
    artifact_repo: ArtifactRepository,
    model: DatasetConfig,
    cycle: str,
    run_id: str,
    snapshot: LoadedRunSnapshot,
) -> RunValidationResult:
    """Validate one run from its snapshot and success markers, then write a report."""

    frames = tuple(model.workload.frames)
    artifact_ids = tuple(model.workload.artifacts)
    expected_markers = _expected_marker_uris(
        artifact_repo=artifact_repo,
        dataset_id=model.id,
        cycle=cycle,
        run_id=run_id,
        frames=frames,
        artifact_ids=artifact_ids,
    )
    existing_markers = artifact_repo.list_success_marker_uris(dataset_id=model.id, cycle=cycle, run_id=run_id)

    errors: list[str] = []
    warnings: list[str] = []

    missing = sorted(expected_markers - existing_markers)
    unexpected = sorted(existing_markers - expected_markers)
    for uri in missing:
        errors.append(f"missing success marker: {uri}")
    for uri in unexpected:
        errors.append(f"unexpected success marker: {uri}")

    grids_by_artifact: dict[str, tuple[str, Mapping[str, Any]]] = {}
    for artifact_id in artifact_ids:
        artifact = model.artifacts.get(artifact_id)
        if artifact is None:
            errors.append(f"missing artifact config for workload artifact: {artifact_id!r}")
            continue
        for frame_id in frames:
            uri = artifact_repo.paths.success_marker_uri_parts(
                dataset_id=model.id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
            )
            if uri in missing:
                continue
            marker = _read_marker(artifact_repo=artifact_repo, uri=uri, errors=errors)
            if marker is None:
                continue
            _validate_marker_identity(
                marker=marker,
                uri=uri,
                dataset_id=model.id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
                config_digest=snapshot.config_digest,
                errors=errors,
            )
            _validate_marker_artifact(
                artifact_repo=artifact_repo,
                marker=marker,
                uri=uri,
                dataset_id=model.id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
                artifact=artifact,
                errors=errors,
            )
            _validate_grid_consistency(
                marker=marker,
                uri=uri,
                artifact_id=artifact_id,
                grids_by_artifact=grids_by_artifact,
                errors=errors,
            )

    status = "failed" if errors else "passed"
    report = {
        "schema": VALIDATION_SCHEMA,
        "schema_version": VALIDATION_SCHEMA_VERSION,
        "dataset_id": model.id,
        "cycle": cycle,
        "run_id": run_id,
        "generated_at": _utc_now_iso(),
        "status": status,
        "payload_check_mode": PAYLOAD_CHECK_MODE,
        "config_digest": snapshot.config_digest,
        "expected": {
            "frames": list(frames),
            "artifacts": list(artifact_ids),
            "marker_count": len(expected_markers),
        },
        "observed": {
            "expected_markers": len(expected_markers & existing_markers),
            "unexpected_markers": len(unexpected),
            "total_markers": len(existing_markers),
        },
        "errors": errors,
        "warnings": warnings,
    }
    report_uri = artifact_repo.write_validation_report(
        dataset_id=model.id,
        cycle=cycle,
        run_id=run_id,
        report=report,
    )
    if errors:
        print(f"Validation failed: {report_uri} errors={len(errors)}", flush=True)
    else:
        print(f"Validation passed: {report_uri}", flush=True)
    return RunValidationResult(
        passed=not errors,
        run_id=run_id,
        report_uri=report_uri,
        report=report,
        errors=tuple(errors),
        warnings=tuple(warnings),
    )


def validation_report_passed(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> tuple[bool, list[str]]:
    """Return whether an existing run validation report is present and passed."""

    uri = artifact_repo.paths.validation_report_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    try:
        report = artifact_repo.read_validation_report(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except FileNotFoundError:
        return False, [f"missing validation report: {uri}"]
    except (Exception, SystemExit) as exc:
        return False, [f"invalid validation report {uri}: {exc}"]

    errors: list[str] = []
    expected = {
        "schema": VALIDATION_SCHEMA,
        "schema_version": VALIDATION_SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": run_id,
        "payload_check_mode": PAYLOAD_CHECK_MODE,
    }
    for field, expected_value in expected.items():
        found = report.get(field)
        if found != expected_value:
            errors.append(
                f"validation report {field} mismatch: expected={expected_value!r} found={found!r} uri={uri}"
            )
    status = report.get("status")
    if status != "passed":
        report_errors = report.get("errors")
        sample = ""
        if isinstance(report_errors, list) and report_errors:
            sample = f": {report_errors[0]}"
        errors.append(f"validation report status is not passed: status={status!r} uri={uri}{sample}")
    return not errors, errors


def _expected_marker_uris(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: tuple[str, ...],
    artifact_ids: tuple[str, ...],
) -> set[str]:
    return {
        artifact_repo.paths.success_marker_uri_parts(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            artifact_id=artifact_id,
        )
        for artifact_id in artifact_ids
        for frame_id in frames
    }


def _read_marker(
    *,
    artifact_repo: ArtifactRepository,
    uri: str,
    errors: list[str],
) -> ArtifactSuccessMarker | None:
    try:
        return artifact_repo.read_artifact_success_marker_uri(uri)
    except (Exception, SystemExit) as exc:
        errors.append(f"invalid success marker: {uri}: {exc}")
        return None


def _validate_marker_identity(
    *,
    marker: ArtifactSuccessMarker,
    uri: str,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    artifact_id: str,
    config_digest: str,
    errors: list[str],
) -> None:
    _add_mismatch_errors(
        errors=errors,
        uri=uri,
        label="success marker",
        actual={
            "dataset_id": marker.dataset_id,
            "cycle": marker.cycle,
            "run_id": marker.run_id,
            "frame_id": marker.frame_id,
            "artifact_id": marker.artifact_id,
            "config_digest": marker.config_digest,
        },
        expected={
            "dataset_id": dataset_id,
            "cycle": cycle,
            "run_id": run_id,
            "frame_id": frame_id,
            "artifact_id": artifact_id,
            "config_digest": config_digest,
        },
    )


def _validate_marker_artifact(
    *,
    artifact_repo: ArtifactRepository,
    marker: ArtifactSuccessMarker,
    uri: str,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    artifact_id: str,
    artifact: ArtifactSpec,
    errors: list[str],
) -> None:
    artifact_marker = marker.artifact
    expected_payload_uri = artifact_repo.paths.output_field_payload_uri(
        item=WorkItem(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            artifact_id=artifact_id,
            source_uri="validation://expected",
        ),
        dtype=artifact.encoding.dtype,
    )
    _add_mismatch_errors(
        errors=errors,
        uri=uri,
        label="artifact metadata",
        actual={
            "payload_uri": artifact_marker.payload_uri,
            "encoding_id": artifact_marker.encoding_id,
            "format": artifact_marker.format,
            "units": artifact_marker.units,
            "parameter": artifact_marker.parameter,
            "level": artifact_marker.level,
            "components": tuple(artifact_marker.components),
        },
        expected={
            "payload_uri": expected_payload_uri,
            "encoding_id": artifact.encoding.id,
            "format": artifact.encoding.format,
            "units": artifact.units,
            "parameter": artifact.parameter,
            "level": artifact.level,
            "components": artifact.component_ids,
        },
    )


def _validate_grid_consistency(
    *,
    marker: ArtifactSuccessMarker,
    uri: str,
    artifact_id: str,
    grids_by_artifact: dict[str, tuple[str, Mapping[str, Any]]],
    errors: list[str],
) -> None:
    current = (marker.artifact.grid_id, marker.artifact.grid)
    first = grids_by_artifact.get(artifact_id)
    if first is None:
        grids_by_artifact[artifact_id] = current
        return
    if first[0] != current[0]:
        errors.append(
            f"grid id mismatch for artifact={artifact_id!r}: first={first[0]!r} "
            f"found={current[0]!r} uri={uri}"
        )
    if first[1] != current[1]:
        errors.append(f"grid metadata mismatch for artifact={artifact_id!r}: grid_id={current[0]!r} uri={uri}")


def _add_mismatch_errors(
    *,
    errors: list[str],
    uri: str,
    label: str,
    actual: Mapping[str, object],
    expected: Mapping[str, object],
) -> None:
    for field, expected_value in expected.items():
        found = actual[field]
        if found != expected_value:
            errors.append(
                f"{label} {field} mismatch: expected={expected_value!r} found={found!r} uri={uri}"
            )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
