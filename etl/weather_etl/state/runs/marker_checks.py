"""Shared run success-marker contract checks."""

from __future__ import annotations

from collections.abc import Mapping

from ...config.pipeline import ArtifactSpec
from ..artifacts.markers_schema import ArtifactSuccessMarker
from ..artifacts.repository import ArtifactRepository


def read_expected_success_marker(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    artifact_id: str,
    artifact: ArtifactSpec,
    product_config_digest: str,
) -> tuple[ArtifactSuccessMarker | None, tuple[str, ...]]:
    """Read one expected success marker and validate its run/artifact identity."""

    uri = artifact_repo.paths.success_marker_uri_parts(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
    )
    try:
        marker = artifact_repo.read_artifact_success_marker_uri(uri)
    except (FileNotFoundError, ValueError, SystemExit) as exc:
        return None, (f"invalid success marker: {uri}: {exc}",)

    errors: list[str] = []
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
            "product_config_digest": marker.product_config_digest,
        },
        expected={
            "dataset_id": dataset_id,
            "cycle": cycle,
            "run_id": run_id,
            "frame_id": frame_id,
            "artifact_id": artifact_id,
            "product_config_digest": product_config_digest,
        },
    )

    expected_payload_uri = artifact_repo.paths.payload_uri_parts(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
        dtype=artifact.encoding.dtype,
    )
    _add_mismatch_errors(
        errors=errors,
        uri=uri,
        label="artifact metadata",
        actual={
            "payload_uri": marker.artifact.payload_uri,
            "encoding_id": marker.artifact.encoding_id,
            "format": marker.artifact.format,
            "units": marker.artifact.units,
            "parameter": marker.artifact.parameter,
            "level": marker.artifact.level,
            "components": tuple(marker.artifact.components),
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
    return marker, tuple(errors)


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
