"""Read-only frame completion evidence used by planning and validation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

from .artifacts.paths import WorkItem
from .artifacts.repository import ArtifactRepository
from .config.resolved import DatasetConfig
from .run_snapshots import LoadedRunSnapshot

FrameEvidenceState = Literal["pending", "missing", "complete", "invalid"]


@dataclass(frozen=True)
class FrameEvidence:
    """Marker-derived state for one dataset/cycle/run frame."""

    frame_id: str
    state: FrameEvidenceState
    expected_marker_count: int
    observed_marker_count: int
    missing_markers: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()

    @property
    def complete(self) -> bool:
        return self.state == "complete"

    @property
    def eligible_for_submission(self) -> bool:
        return self.state in {"pending", "missing"}


def inspect_frame_evidence(
    *,
    artifact_repo: ArtifactRepository,
    dataset: DatasetConfig,
    cycle: str,
    run_id: str,
    snapshot: LoadedRunSnapshot,
    frame_id: str,
    artifact_ids: Iterable[str],
) -> FrameEvidence:
    """Classify one frame from success-marker evidence without writing state."""

    selected_artifact_ids = tuple(artifact_ids)
    expected_uris = tuple(
        artifact_repo.paths.success_marker_uri_parts(
            dataset_id=dataset.id,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            artifact_id=artifact_id,
        )
        for artifact_id in selected_artifact_ids
    )
    existing_uris = {
        uri
        for uri in expected_uris
        if artifact_repo.store.exists(uri=uri)
    }
    missing = tuple(uri for uri in expected_uris if uri not in existing_uris)
    errors: list[str] = []

    for artifact_id, uri in zip(selected_artifact_ids, expected_uris, strict=True):
        if uri in missing:
            continue
        artifact = dataset.artifacts.get(artifact_id)
        if artifact is None:
            errors.append(f"missing artifact config for workload artifact: {artifact_id!r}")
            continue
        try:
            marker = artifact_repo.read_artifact_success_marker_uri(uri)
        except (Exception, SystemExit) as exc:
            errors.append(f"invalid success marker: {uri}: {exc}")
            continue

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
                "dataset_id": dataset.id,
                "cycle": cycle,
                "run_id": run_id,
                "frame_id": frame_id,
                "artifact_id": artifact_id,
                "config_digest": snapshot.config_digest,
            },
        )

        expected_payload_uri = artifact_repo.paths.output_field_payload_uri(
            item=WorkItem(
                dataset_id=dataset.id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
                source_uri="frame-evidence://expected",
            ),
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

    if errors:
        state: FrameEvidenceState = "invalid"
    elif not existing_uris:
        state = "pending"
    elif missing:
        state = "missing"
    else:
        state = "complete"

    return FrameEvidence(
        frame_id=frame_id,
        state=state,
        expected_marker_count=len(expected_uris),
        observed_marker_count=len(existing_uris),
        missing_markers=missing,
        errors=tuple(errors),
    )


def _add_mismatch_errors(
    *,
    errors: list[str],
    uri: str,
    label: str,
    actual: dict[str, object],
    expected: dict[str, object],
) -> None:
    for field, expected_value in expected.items():
        found = actual[field]
        if found != expected_value:
            errors.append(
                f"{label} {field} mismatch: expected={expected_value!r} found={found!r} uri={uri}"
            )
