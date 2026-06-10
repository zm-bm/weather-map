"""Workload selection helpers for configured dataset workloads."""

from __future__ import annotations

from collections.abc import Iterable

from ..config.pipeline import DatasetConfig


class WorkloadSelectionError(ValueError):
    """Invalid configured workload selection."""


def selected_workload_artifact_ids(dataset: DatasetConfig, selected: Iterable[str] | None) -> tuple[str, ...]:
    """Return configured workload artifact ids filtered by an optional selection."""

    workload_artifacts = tuple(dataset.workload.artifacts or ())
    if selected is None:
        return workload_artifacts

    requested = {artifact_id.strip() for artifact_id in selected if artifact_id.strip()}
    if not requested:
        raise WorkloadSelectionError("artifact selection requires at least one non-empty artifact id")

    unknown = sorted(requested - set(workload_artifacts))
    if unknown:
        raise WorkloadSelectionError(
            f"Unknown artifact id(s) for dataset {dataset.id!r}: {unknown!r}; "
            f"configured artifacts: {list(workload_artifacts)!r}"
        )

    return tuple(artifact_id for artifact_id in workload_artifacts if artifact_id in requested)


def selected_workload_frame_ids(*, configured: Iterable[str], selected: Iterable[str] | None) -> tuple[str, ...]:
    """Return configured workload frame ids filtered by an optional selection."""

    configured_frames = tuple(str(frame_id) for frame_id in configured)
    if selected is None:
        return configured_frames

    requested = tuple(selected)
    unknown = [frame_id for frame_id in requested if frame_id not in configured_frames]
    if unknown:
        raise WorkloadSelectionError(f"Unknown frame id(s): {unknown!r}; configured frames: {list(configured_frames)!r}")

    requested_set = set(requested)
    return tuple(frame_id for frame_id in configured_frames if frame_id in requested_set)
