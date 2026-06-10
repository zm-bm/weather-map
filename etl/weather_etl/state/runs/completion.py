"""Read-only frame completion state used by cycle planning."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

from ...config.pipeline import ArtifactSpec, DatasetConfig
from ..artifacts.repository import ArtifactRepository
from .marker_checks import read_expected_success_marker
from .snapshots import LoadedRunSnapshot

FrameCompletionState = Literal["pending", "missing", "complete", "invalid"]


@dataclass(frozen=True)
class FrameCompletion:
    """Marker-derived state for one dataset/cycle/run frame."""

    frame_id: str
    state: FrameCompletionState
    expected_marker_count: int
    observed_marker_count: int
    missing_markers: tuple[str, ...] = ()
    errors: tuple[str, ...] = ()


def inspect_frame_completion(
    *,
    artifact_repo: ArtifactRepository,
    dataset: DatasetConfig,
    cycle: str,
    run_id: str,
    snapshot: LoadedRunSnapshot,
    frame_id: str,
    artifact_ids: Iterable[str],
) -> FrameCompletion:
    """Classify one frame from success markers without writing state."""

    selected_artifact_ids = tuple(artifact_ids)
    selected_artifacts, errors = _selected_artifacts(dataset=dataset, artifact_ids=selected_artifact_ids)
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

    for artifact_id, artifact, uri in zip(selected_artifact_ids, selected_artifacts, expected_uris, strict=True):
        if uri in missing:
            continue
        if artifact is None:
            continue
        _, marker_errors = read_expected_success_marker(
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

    if errors:
        state: FrameCompletionState = "invalid"
    elif not existing_uris:
        state = "pending"
    elif missing:
        state = "missing"
    else:
        state = "complete"

    return FrameCompletion(
        frame_id=frame_id,
        state=state,
        expected_marker_count=len(expected_uris),
        observed_marker_count=len(existing_uris),
        missing_markers=missing,
        errors=tuple(errors),
    )


def _selected_artifacts(
    *,
    dataset: DatasetConfig,
    artifact_ids: tuple[str, ...],
) -> tuple[tuple[ArtifactSpec | None, ...], list[str]]:
    errors: list[str] = []
    artifacts: list[ArtifactSpec | None] = []
    for artifact_id in artifact_ids:
        artifact = dataset.artifacts.get(artifact_id)
        if artifact is None:
            errors.append(f"missing artifact config for workload artifact: {artifact_id!r}")
        artifacts.append(artifact)
    return tuple(artifacts), errors
