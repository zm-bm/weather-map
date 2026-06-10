"""Build manifest artifact entries from success markers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from weather_etl.config.encoding import LINEAR_DECODE_FORMULA, is_linear_encoding_format

from ...config.pipeline import ArtifactSpec
from ...core.validation import validated_dict
from ..artifacts.markers_schema import ArtifactMarkerPayload, ArtifactSuccessMarker
from ..artifacts.repository import ArtifactRepository
from .schema import ManifestArtifact


@dataclass(frozen=True)
class _ManifestFrameCandidate:
    frame_id: str
    marker_uri: str
    marker_payload: ArtifactMarkerPayload
    frame_entry: dict[str, Any]

    @property
    def grid_id(self) -> str:
        return self.marker_payload.grid_id

    @property
    def grid(self) -> dict[str, Any]:
        return self.marker_payload.grid

    @property
    def manifest_grid(self) -> dict[str, Any]:
        return {"id": self.grid_id, **self.grid}


def build_manifest_artifact_entry(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: tuple[str, ...],
    artifact_id: str,
    artifact: ArtifactSpec,
    markers_by_frame: Mapping[str, ArtifactSuccessMarker],
) -> dict[str, Any]:
    """Build one manifest artifact entry from success markers and config."""

    encoding_entry = _manifest_encoding_from_artifact(artifact)
    candidates = tuple(
        _build_frame_candidate(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            artifact_id=artifact_id,
            artifact=artifact,
            marker=markers_by_frame[frame_id],
            encoding_entry=encoding_entry,
        )
        for frame_id in frames
    )

    artifact_entry: dict[str, Any] = {
        "id": artifact_id,
        "kind": artifact.kind,
        "units": artifact.units,
        "parameter": artifact.parameter,
        "level": artifact.level,
        "components": artifact.component_ids,
        "grid": _shared_grid(artifact_id=artifact_id, candidates=candidates),
        "encoding": encoding_entry,
        "frames": {candidate.frame_id: candidate.frame_entry for candidate in candidates},
        "payload_file": artifact_repo.paths.payload_filename(
            artifact_id=artifact_id,
            dtype=artifact.encoding.dtype,
        ),
    }
    if artifact.temporal is not None:
        artifact_entry["temporal_kind"] = artifact.temporal.kind
        if artifact.temporal.source_interval_hours is not None:
            artifact_entry["source_interval_hours"] = artifact.temporal.source_interval_hours

    return validated_dict(
        ManifestArtifact,
        artifact_entry,
        exclude_none=True,
    )


def _build_frame_candidate(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    artifact_id: str,
    artifact: ArtifactSpec,
    marker: ArtifactSuccessMarker,
    encoding_entry: Mapping[str, Any],
) -> _ManifestFrameCandidate:
    marker_uri = artifact_repo.paths.success_marker_uri_parts(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
    )
    marker_payload = marker.artifact
    expected_payload_uri = artifact_repo.paths.payload_uri_parts(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
        dtype=artifact.encoding.dtype,
    )

    _assert_marker_payload_matches_config(
        marker_uri=marker_uri,
        artifact=artifact,
        marker_payload=marker_payload,
        encoding_entry=encoding_entry,
        expected_payload_uri=expected_payload_uri,
    )

    return _ManifestFrameCandidate(
        frame_id=frame_id,
        marker_uri=marker_uri,
        marker_payload=marker_payload,
        frame_entry={
            "path": _relative_artifact_path(
                artifact_repo=artifact_repo,
                uri=marker_payload.payload_uri,
            ),
            "byte_length": marker_payload.byte_length,
            "sha256": marker_payload.sha256,
        },
    )


def _assert_marker_payload_matches_config(
    *,
    marker_uri: str,
    artifact: ArtifactSpec,
    marker_payload: ArtifactMarkerPayload,
    encoding_entry: Mapping[str, Any],
    expected_payload_uri: str,
) -> None:
    """Fail when marker artifact metadata no longer matches current config."""

    _assert_fields_match(
        label="Artifact",
        marker_uri=marker_uri,
        actual={
            "payload_uri": marker_payload.payload_uri,
            "encoding_id": marker_payload.encoding_id,
            "format": marker_payload.format,
            "units": marker_payload.units,
            "parameter": marker_payload.parameter,
            "level": marker_payload.level,
            "components": tuple(marker_payload.components),
        },
        expected={
            "payload_uri": expected_payload_uri,
            "encoding_id": encoding_entry["id"],
            "format": encoding_entry["format"],
            "units": artifact.units,
            "parameter": artifact.parameter,
            "level": artifact.level,
            "components": artifact.component_ids,
        },
    )


def _manifest_encoding_from_artifact(artifact: ArtifactSpec) -> dict[str, Any]:
    """Build manifest encoding metadata from a resolved artifact config."""

    encoding = artifact.encoding
    metadata: dict[str, Any] = {
        "id": encoding.id,
        "format": encoding.format,
        "dtype": encoding.dtype,
        "byte_order": encoding.byte_order,
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


def _shared_grid(
    *,
    artifact_id: str,
    candidates: tuple[_ManifestFrameCandidate, ...],
) -> dict[str, Any]:
    """Return common grid metadata for all artifact frames."""

    if not candidates:
        raise SystemExit(f"No artifact metadata found for artifact={artifact_id!r}") from None

    first = candidates[0]

    for candidate in candidates[1:]:
        if first.grid_id != candidate.grid_id:
            raise SystemExit(
                f"Grid id mismatch across frames for artifact={artifact_id!r}: "
                f"first={first.grid_id!r} current={candidate.grid_id!r} "
                f"marker={candidate.marker_uri}"
            )
        if first.grid != candidate.grid:
            raise SystemExit(
                f"Grid metadata mismatch across frames for artifact={artifact_id!r}: "
                f"grid_id={candidate.grid_id!r} marker={candidate.marker_uri}"
            )

    return first.manifest_grid


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
