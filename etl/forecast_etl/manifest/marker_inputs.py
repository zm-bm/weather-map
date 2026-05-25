"""Success marker inputs for manifest assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..artifacts.markers_schema import ArtifactMarkerPayload
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec
from ..encoding.codecs import LINEAR_DECODE_FORMULA, is_linear_encoding_format
from .schema import manifest_encoding, manifest_frame, manifest_grid


@dataclass(frozen=True)
class ArtifactManifestInputs:
    """Manifest-ready marker-derived inputs for one artifact."""

    encoding: dict[str, Any]
    grid: dict[str, Any]
    frames: dict[str, dict[str, Any]]


def artifact_manifest_inputs_from_markers(
    *,
    artifact_repo: ArtifactRepository,
    model_id: str,
    cycle: str,
    fhours: tuple[str, ...],
    artifact_id: str,
    artifact: ArtifactSpec,
) -> ArtifactManifestInputs:
    """Read artifact markers and validate them against publish context/config."""

    raw_encoding_entry = _encoding_marker_metadata_for_artifact(artifact)
    encoding_id = str(raw_encoding_entry.pop("encoding_id"))

    first_grid_id: str | None = None
    first_grid: dict[str, Any] | None = None
    frames: dict[str, dict[str, Any]] = {}

    for fhour in fhours:
        marker_uri = artifact_repo.paths.success_marker_uri_parts(
            model_id=model_id,
            cycle=cycle,
            fhour=fhour,
            artifact_id=artifact_id,
        )
        marker = artifact_repo.read_artifact_success_marker_uri(marker_uri)
        artifact_marker = marker.artifact

        _assert_fields_match(
            label="Success marker",
            marker_uri=marker_uri,
            actual={
                "cycle": marker.cycle,
                "fhour": marker.fhour,
                "artifact_id": marker.artifact_id,
            },
            expected={
                "cycle": cycle,
                "fhour": fhour,
                "artifact_id": artifact_id,
            },
        )
        _assert_marker_metadata_matches_artifact(
            marker_uri=marker_uri,
            artifact=artifact,
            artifact_marker=artifact_marker,
            encoding_id=encoding_id,
            encoding_entry=raw_encoding_entry,
        )

        if first_grid_id is None:
            first_grid_id = artifact_marker.grid_id
            first_grid = artifact_marker.grid
        elif first_grid_id != artifact_marker.grid_id:
            raise SystemExit(
                f"Grid id mismatch across forecast hours for artifact={artifact_id!r}: "
                f"first={first_grid_id!r} current={artifact_marker.grid_id!r} marker={marker_uri}"
            )
        elif first_grid != artifact_marker.grid:
            raise SystemExit(
                f"Grid metadata mismatch across forecast hours for artifact={artifact_id!r}: "
                f"grid_id={artifact_marker.grid_id!r} marker={marker_uri}"
            )

        frames[fhour] = manifest_frame(
            path=_relative_artifact_path(artifact_repo=artifact_repo, uri=artifact_marker.payload_uri),
            byte_length=artifact_marker.byte_length,
            sha256=artifact_marker.sha256,
        )

    if first_grid_id is None or first_grid is None:
        raise SystemExit(f"No artifact metadata found for artifact={artifact_id!r}")

    return ArtifactManifestInputs(
        encoding=manifest_encoding(encoding_id=encoding_id, encoding=raw_encoding_entry),
        grid=manifest_grid(grid_id=first_grid_id, grid=first_grid),
        frames=frames,
    )


def _assert_marker_metadata_matches_artifact(
    *,
    marker_uri: str,
    artifact: ArtifactSpec,
    artifact_marker: ArtifactMarkerPayload,
    encoding_id: str,
    encoding_entry: Mapping[str, Any],
) -> None:
    """Fail when marker artifact metadata no longer matches current config."""

    _assert_fields_match(
        label="Artifact",
        marker_uri=marker_uri,
        actual={
            "encoding_id": artifact_marker.encoding_id,
            "format": artifact_marker.format,
            "units": artifact_marker.units,
            "parameter": artifact_marker.parameter,
            "level": artifact_marker.level,
            "components": tuple(artifact_marker.components),
        },
        expected={
            "encoding_id": encoding_id,
            "format": encoding_entry["format"],
            "units": artifact.units,
            "parameter": artifact.parameter,
            "level": artifact.level,
            "components": artifact.component_ids,
        },
    )


def _encoding_marker_metadata_for_artifact(artifact: ArtifactSpec) -> dict[str, Any]:
    """Build manifest encoding metadata from a resolved artifact config."""

    encoding = artifact.encoding
    metadata: dict[str, Any] = {
        "format": encoding.format,
        "dtype": encoding.dtype,
        "byte_order": encoding.byte_order,
        "encoding_id": encoding.id,
    }
    if encoding.nodata is not None:
        metadata["nodata"] = encoding.nodata
    if is_linear_encoding_format(encoding.format):
        metadata["scale"] = encoding.scale
        metadata["offset"] = encoding.offset
        metadata["decode_formula"] = LINEAR_DECODE_FORMULA
    if encoding.finite_value_range is not None:
        metadata["finite_value_range"] = {
            "min": encoding.finite_value_range.min,
            "max": encoding.finite_value_range.max,
        }
    return metadata


def _assert_fields_match(
    *,
    label: str,
    marker_uri: str,
    actual: Mapping[str, object],
    expected: Mapping[str, object],
) -> None:
    """Compare marker fields and raise stable domain mismatch messages."""

    for field, expected_value in expected.items():
        actual_value = actual[field]
        if actual_value != expected_value:
            raise SystemExit(
                f"{label} {field} mismatch in marker {marker_uri}: "
                f"marker={actual_value!r} expected={expected_value!r}"
            )


def _relative_artifact_path(*, artifact_repo: ArtifactRepository, uri: str) -> str:
    """Return a manifest path for a payload URI under the artifact root."""

    try:
        rel = artifact_repo.paths.relative_key(uri)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    if not rel:
        raise SystemExit(f"Payload URI resolved to empty relative path: {uri!r}")
    return rel
