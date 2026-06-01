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
    FORECAST_BINARY_CONTRACT,
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
    model_id: str,
    cycle: str,
    run_id: str,
    fhours: Iterable[str],
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    marker_cache: Mapping[tuple[str, str], ArtifactSuccessMarker] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build manifest artifact entries from success markers and artifact config."""

    manifest_artifacts: dict[str, dict[str, Any]] = {}
    fhours = tuple(str(fhour) for fhour in fhours)

    for artifact_id in artifact_ids:
        artifact = artifact_specs.get(artifact_id)
        if artifact is None:
            raise SystemExit(f"Missing artifact config for artifact {artifact_id!r}")

        marker_inputs = artifact_manifest_inputs_from_markers(
            artifact_repo=artifact_repo,
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
            fhours=fhours,
            artifact_id=artifact_id,
            artifact=artifact,
            markers_by_fhour=(
                {fhour: marker_cache[(artifact_id, fhour)] for fhour in fhours}
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
            "payloadFile": artifact_repo.paths.field_payload_filename(
                artifact_id=artifact_id,
                dtype=artifact.encoding.dtype,
            ),
        }
        if artifact.temporal is not None:
            artifact_entry["temporalKind"] = artifact.temporal.kind
            if artifact.temporal.source_interval_hours is not None:
                artifact_entry["sourceIntervalHours"] = artifact.temporal.source_interval_hours
        manifest_artifacts[artifact_id] = validated_dict(
            ManifestArtifact,
            artifact_entry,
            by_alias=True,
            exclude_none=True,
        )

    return manifest_artifacts


def build_cycle_manifest(
    *,
    model_id: str,
    model_label: str,
    cycle: str,
    run_id: str,
    payload_root: str,
    generated_at: str,
    fhours: Iterable[str],
    artifacts: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Build a complete cycle manifest and compute its stable revision."""

    run = {
        "cycle": cycle,
        "runId": run_id,
        "payloadRoot": payload_root,
        "generatedAt": generated_at,
    }
    manifest_obj = {
        "schema": MANIFEST_SCHEMA,
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "payloadContract": FORECAST_BINARY_CONTRACT,
        "model": {
            "id": model_id,
            "label": model_label,
        },
        "run": run,
        "times": _manifest_times(cycle=cycle, fhours=fhours),
        "artifacts": artifacts,
    }
    run["revision"] = compute_manifest_revision(manifest_obj)
    return cycle_manifest(manifest_obj)


def _manifest_times(*, cycle: str, fhours: Iterable[str]) -> list[dict[str, object]]:
    """Build manifest time entries from a cycle and forecast-hour ids."""

    cycle_dt = cycle_datetime(cycle)
    times: list[dict[str, object]] = []
    for fhour in fhours:
        lead_hours = int(fhour)
        times.append(
            manifest_time(
                fhour=fhour,
                lead_hours=lead_hours,
                valid_at=(cycle_dt + timedelta(hours=lead_hours)).isoformat().replace("+00:00", "Z"),
            )
        )
    return times
