"""Build frontend manifest sections from artifact success markers."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Iterable, Mapping

from ..artifacts.markers_schema import ArtifactSuccessMarker
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec
from ..cycles import cycle_datetime
from ..validation import validated_dict
from .constants import (
    DATA_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from .marker_inputs import artifact_manifest_inputs_from_markers
from .revision import compute_manifest_revision
from .schema import (
    ManifestArtifact,
    cycle_manifest,
    manifest_time,
)


def build_manifest_artifacts(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: Iterable[str],
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    marker_cache: Mapping[tuple[str, str], ArtifactSuccessMarker] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build manifest artifact entries from success markers and artifact config."""

    manifest_artifacts: dict[str, dict[str, Any]] = {}
    frames = tuple(str(frame_id) for frame_id in frames)

    for artifact_id in artifact_ids:
        artifact = artifact_specs.get(artifact_id)
        if artifact is None:
            raise SystemExit(f"Missing artifact config for artifact {artifact_id!r}")

        marker_inputs = artifact_manifest_inputs_from_markers(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frames=frames,
            artifact_id=artifact_id,
            artifact=artifact,
            markers_by_frame=(
                {frame_id: marker_cache[(artifact_id, frame_id)] for frame_id in frames}
                if marker_cache is not None
                else None
            ),
        )
        artifact_entry: dict[str, Any] = {
            "id": artifact_id,
            "kind": artifact.kind,
            "units": artifact.units,
            "parameter": artifact.parameter,
            "level": artifact.level,
            "components": artifact.component_ids,
            "grid": marker_inputs.grid,
            "encoding": marker_inputs.encoding,
            "frames": marker_inputs.frames,
            "payload_file": artifact_repo.paths.field_payload_filename(
                artifact_id=artifact_id,
                dtype=artifact.encoding.dtype,
            ),
        }
        if artifact.temporal is not None:
            artifact_entry["temporal_kind"] = artifact.temporal.kind
            if artifact.temporal.source_interval_hours is not None:
                artifact_entry["source_interval_hours"] = artifact.temporal.source_interval_hours
        manifest_artifacts[artifact_id] = validated_dict(
            ManifestArtifact,
            artifact_entry,
            exclude_none=True,
        )

    return manifest_artifacts


def build_cycle_manifest(
    *,
    dataset_id: str,
    dataset_label: str,
    cycle: str,
    run_id: str,
    payload_root: str,
    generated_at: str,
    frames: Iterable[str],
    artifacts: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Build a complete cycle manifest and compute its stable revision."""

    run = {
        "cycle": cycle,
        "run_id": run_id,
        "payload_root": payload_root,
        "generated_at": generated_at,
    }
    manifest_obj = {
        "schema": MANIFEST_SCHEMA,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "payload_contract": DATA_BINARY_CONTRACT,
        "dataset": {
            "id": dataset_id,
            "label": dataset_label,
        },
        "run": run,
        "frames": _manifest_frames(cycle=cycle, frames=frames),
        "artifacts": artifacts,
    }
    run["revision"] = compute_manifest_revision(manifest_obj)
    return cycle_manifest(manifest_obj)


def _manifest_frames(*, cycle: str, frames: Iterable[str]) -> list[dict[str, object]]:
    """Build manifest frame entries from a cycle and frame ids."""

    cycle_dt = cycle_datetime(cycle)
    frame_entries: list[dict[str, object]] = []
    for frame_id in frames:
        lead_hours = int(frame_id)
        frame_entries.append(
            manifest_time(
                frame_id=frame_id,
                lead_hours=lead_hours,
                valid_at=(cycle_dt + timedelta(hours=lead_hours)).isoformat().replace("+00:00", "Z"),
            )
        )
    return frame_entries
