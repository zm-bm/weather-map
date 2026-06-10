"""Run-scoped validation before public manifest publication."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ...config.pipeline import DatasetConfig
from ...core.timestamps import utc_now_iso
from ..artifacts.markers_schema import ArtifactSuccessMarker
from ..artifacts.repository import ArtifactRepository
from .marker_checks import read_expected_success_marker
from .snapshots import LoadedRunSnapshot

VALIDATION_SCHEMA = "weather-map.etl-run-validation"
VALIDATION_SCHEMA_VERSION = 2
PAYLOAD_CHECK_MODE = "marker_metadata_only"


@dataclass(frozen=True)
class RunValidationResult:
    """Outcome of validating one immutable ETL run."""

    passed: bool
    run_id: str
    report_uri: str
    report: dict[str, Any]
    errors: tuple[str, ...]


def validate_run(
    *,
    artifact_repo: ArtifactRepository,
    dataset: DatasetConfig,
    cycle: str,
    run_id: str,
    snapshot: LoadedRunSnapshot,
) -> RunValidationResult:
    """Validate one run from its snapshot and success markers, then write a report."""

    frames = tuple(dataset.workload.frames)
    artifact_ids = tuple(dataset.workload.artifacts)
    expected_marker_uris = _expected_marker_uris(
        artifact_repo=artifact_repo,
        dataset_id=dataset.id,
        cycle=cycle,
        run_id=run_id,
        frames=frames,
        artifact_ids=artifact_ids,
    )
    existing_marker_uris = artifact_repo.list_success_marker_uris(dataset_id=dataset.id, cycle=cycle, run_id=run_id)

    errors: list[str] = []

    missing_marker_uris = sorted(expected_marker_uris - existing_marker_uris)
    unexpected_marker_uris = sorted(existing_marker_uris - expected_marker_uris)
    for uri in missing_marker_uris:
        errors.append(f"missing success marker: {uri}")
    for uri in unexpected_marker_uris:
        errors.append(f"unexpected success marker: {uri}")

    grids_by_artifact: dict[str, tuple[str, Mapping[str, Any]]] = {}
    for artifact_id in artifact_ids:
        artifact = dataset.artifacts.get(artifact_id)
        if artifact is None:
            errors.append(f"missing artifact config for workload artifact: {artifact_id!r}")
            continue
        for frame_id in frames:
            uri = artifact_repo.paths.success_marker_uri_parts(
                dataset_id=dataset.id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
            )
            if uri in missing_marker_uris:
                continue
            marker, marker_errors = read_expected_success_marker(
                artifact_repo=artifact_repo,
                dataset_id=dataset.id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
                artifact=artifact,
                product_config_digest=snapshot.product_config_digest,
            )
            errors.extend(marker_errors)
            if marker is None:
                continue
            _validate_grid_consistency(
                marker=marker,
                uri=uri,
                artifact_id=artifact_id,
                grids_by_artifact=grids_by_artifact,
                errors=errors,
            )

    status = "failed" if errors else "passed"
    report = {
        **_validation_report_identity(dataset_id=dataset.id, cycle=cycle, run_id=run_id),
        "generated_at": utc_now_iso(),
        "status": status,
        "product_config_digest": snapshot.product_config_digest,
        "expected": {
            "frames": list(frames),
            "artifacts": list(artifact_ids),
            "marker_count": len(expected_marker_uris),
        },
        "observed": {
            "expected_markers": len(expected_marker_uris & existing_marker_uris),
            "unexpected_markers": len(unexpected_marker_uris),
            "total_markers": len(existing_marker_uris),
        },
        "errors": errors,
        "warnings": [],
    }
    report_uri = artifact_repo.write_validation_report(
        dataset_id=dataset.id,
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
    except (ValueError, SystemExit) as exc:
        return False, [f"invalid validation report {uri}: {exc}"]
    if not isinstance(report, Mapping):
        return False, [f"invalid validation report {uri}: expected JSON object"]

    errors: list[str] = []
    expected = _validation_report_identity(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
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


def _validation_report_identity(*, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    return {
        "schema": VALIDATION_SCHEMA,
        "schema_version": VALIDATION_SCHEMA_VERSION,
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": run_id,
        "payload_check_mode": PAYLOAD_CHECK_MODE,
    }


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
