"""Build public cycle manifests from publish markers."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Iterable, Mapping

from ...config.pipeline import ArtifactSpec
from ...core.cycles import cycle_datetime
from ...core.frames import parse_lead_hour_frame_id
from ...core.timestamps import isoformat_utc, parse_iso_datetime_utc
from ...core.validation import parse_model
from ..artifacts.markers_schema import ArtifactSuccessMarker
from ..artifacts.repository import ArtifactRepository
from .artifact_entry import build_manifest_artifact_entry
from .constants import (
    DATA_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from .revision import compute_manifest_revision
from .schema import CycleManifest


def build_manifest_artifacts(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: Iterable[str],
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    publish_marker_cache: Mapping[tuple[str, str], ArtifactSuccessMarker],
) -> dict[str, dict[str, Any]]:
    """Build manifest artifact entries from success markers and artifact config."""

    manifest_artifacts: dict[str, dict[str, Any]] = {}
    frames = tuple(str(frame_id) for frame_id in frames)

    for artifact_id in artifact_ids:
        artifact = artifact_specs.get(artifact_id)
        if artifact is None:
            raise SystemExit(f"Missing artifact config for artifact {artifact_id!r}")

        manifest_artifacts[artifact_id] = build_manifest_artifact_entry(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frames=frames,
            artifact_id=artifact_id,
            artifact=artifact,
            markers_by_frame={
                frame_id: publish_marker_cache[(artifact_id, frame_id)]
                for frame_id in frames
            },
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
    frame_valid_times: Mapping[str, str] | None = None,
) -> CycleManifest:
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
        "frames": _cycle_frame_entries(cycle=cycle, frames=frames, frame_valid_times=frame_valid_times),
        "artifacts": artifacts,
    }
    run["revision"] = compute_manifest_revision(manifest_obj)
    return parse_model(CycleManifest, manifest_obj)


def _cycle_frame_entries(
    *,
    cycle: str,
    frames: Iterable[str],
    frame_valid_times: Mapping[str, str] | None,
) -> list[dict[str, object]]:
    """Build manifest frame entries from a cycle and frame ids."""

    cycle_dt = cycle_datetime(cycle)
    frame_entries: list[dict[str, object]] = []
    for frame_id in frames:
        if frame_valid_times is not None:
            valid_at = frame_valid_times.get(frame_id)
            if valid_at is None:
                raise SystemExit(f"Cycle manifest missing valid_at override for frame id: {frame_id!r}")
            frame_entries.append({
                "id": frame_id,
                "lead_hours": 0,
                "valid_at": isoformat_utc(parse_iso_datetime_utc(valid_at)),
            })
            continue
        try:
            lead_hours = parse_lead_hour_frame_id(frame_id)
        except ValueError as exc:
            raise SystemExit(f"Cycle manifest frame requires a lead-hour frame id: {exc}") from None
        frame_entries.append({
            "id": frame_id,
            "lead_hours": lead_hours,
            "valid_at": isoformat_utc(cycle_dt + timedelta(hours=lead_hours)),
        })
    return frame_entries
