"""Status artifact helpers for forecast cycles."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..config.resolved import DatasetConfig
from ..run_ids import validate_run_id
from ..storage.base import UriObject, UriStore
from .markers_schema import parse_artifact_success_marker
from .paths import PUBLISHED_MARKER_FILENAME, SUCCESS_MARKER_SUFFIX, ArtifactPaths
from .repository import ArtifactRepository

DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT = 5
DEFAULT_MISSING_SAMPLE_LIMIT = 12


@dataclass(frozen=True)
class _ArtifactListing:
    key: str
    uri: str
    last_modified: datetime | None


@dataclass(frozen=True)
class CycleProgress:
    """Computed progress for one dataset cycle from status artifacts."""

    cycle: str
    published: bool
    manifest_present: bool
    expected_markers: int
    found_markers: int
    missing_markers: int
    last_progress_at: datetime | None
    missing_sample: tuple[str, ...]
    invalid_marker_sample: tuple[str, ...]
    run_id: str | None = None
    run_count: int = 0

    @property
    def complete(self) -> bool:
        return self.expected_markers > 0 and self.missing_markers == 0 and not self.invalid_marker_sample


def expected_success_marker_ids(*, artifact_ids: Iterable[str], frames: Iterable[str]) -> set[str]:
    """Return expected status marker ids as {artifact_id}/{frame_id}."""

    return {f"{artifact_id}/{frame_id}" for artifact_id in artifact_ids for frame_id in frames}


def run_id_from_key(*, dataset_id: str, cycle: str, key: str) -> str | None:
    """Return run id for a run-scoped key, or None."""

    parts = key.split("/")
    if len(parts) < 4 or parts[:3] != ["runs", dataset_id, cycle]:
        return None
    try:
        return validate_run_id(parts[3])
    except ValueError:
        return None


def success_marker_id_from_key(
    *,
    dataset_id: str,
    cycle: str,
    key: str,
    run_id: str | None = None,
) -> str | None:
    """Return {artifact_id}/{frame_id} for a success marker key, or None."""

    parts = key.split("/")
    if len(parts) != 7:
        return None
    runs_part, key_model, key_cycle, key_run_id, status_part, artifact_id, filename = parts
    if runs_part != "runs" or status_part != "status" or key_model != dataset_id or key_cycle != cycle:
        return None
    try:
        parsed_run_id = validate_run_id(key_run_id)
    except ValueError:
        return None
    if run_id is not None and parsed_run_id != run_id:
        return None
    if not filename.endswith(SUCCESS_MARKER_SUFFIX):
        return None
    frame_id = filename[: -len(SUCCESS_MARKER_SUFFIX)]
    if not frame_id:
        return None
    return f"{artifact_id}/{frame_id}"


def published_marker_key(*, dataset_id: str, cycle: str, run_id: str) -> str:
    return f"runs/{dataset_id}/{cycle}/{validate_run_id(run_id)}/{PUBLISHED_MARKER_FILENAME}"


def is_published_marker_key(*, dataset_id: str, cycle: str, run_id: str, key: str) -> bool:
    return key == published_marker_key(dataset_id=dataset_id, cycle=cycle, run_id=run_id)


def summarize_cycle_progress(
    *,
    artifact_root_uri: str,
    dataset_id: str,
    cycle: str,
    artifact_ids: Iterable[str],
    frames: Iterable[str],
    objects: Iterable[UriObject],
    read_json: Callable[[str], Mapping[str, Any]],
    run_id: str | None = None,
    manifest_present: bool = False,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> CycleProgress:
    """Summarize marker progress from listed status artifacts."""

    paths = ArtifactPaths(artifact_root_uri)
    listed = tuple(
        _ArtifactListing(
            key=paths.relative_key(obj.uri),
            uri=obj.uri,
            last_modified=obj.last_modified,
        )
        for obj in objects
    )
    run_ids = sorted({
        parsed
        for obj in listed
        for parsed in [run_id_from_key(dataset_id=dataset_id, cycle=cycle, key=obj.key)]
        if parsed is not None
    })
    selected_run_id = validate_run_id(run_id) if run_id is not None else (run_ids[-1] if run_ids else None)
    published = (
        selected_run_id is not None
        and any(is_published_marker_key(dataset_id=dataset_id, cycle=cycle, run_id=selected_run_id, key=obj.key) for obj in listed)
    )
    marker_objects = [
        obj
        for obj in listed
        if selected_run_id is not None
        and obj.key.endswith(SUCCESS_MARKER_SUFFIX)
        and run_id_from_key(dataset_id=dataset_id, cycle=cycle, key=obj.key) == selected_run_id
    ]
    marker_by_id = {
        marker_id: obj
        for obj in marker_objects
        for marker_id in [success_marker_id_from_key(dataset_id=dataset_id, cycle=cycle, key=obj.key, run_id=selected_run_id)]
        if marker_id is not None
    }

    expected = expected_success_marker_ids(artifact_ids=artifact_ids, frames=frames)
    found = set(marker_by_id) & expected
    missing = sorted(expected - found)
    invalid = _invalid_marker_sample(
        read_json=read_json,
        marker_by_id=marker_by_id,
        found=found,
        limit=marker_validation_sample_limit,
    )
    last_progress_at = _latest_modified(
        obj.last_modified
        for obj in listed
        if selected_run_id is not None
        and (
            (
                obj.key.endswith(SUCCESS_MARKER_SUFFIX)
                and run_id_from_key(dataset_id=dataset_id, cycle=cycle, key=obj.key) == selected_run_id
            )
            or is_published_marker_key(dataset_id=dataset_id, cycle=cycle, run_id=selected_run_id, key=obj.key)
        )
    )

    return CycleProgress(
        cycle=cycle,
        published=published,
        manifest_present=manifest_present,
        expected_markers=len(expected),
        found_markers=len(found),
        missing_markers=len(missing),
        last_progress_at=last_progress_at,
        missing_sample=tuple(missing[:missing_sample_limit]),
        invalid_marker_sample=tuple(invalid),
        run_id=selected_run_id,
        run_count=len(run_ids),
    )


def read_cycle_progress(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    model: DatasetConfig,
    cycle: str,
    manifest_present: bool = False,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> CycleProgress:
    """Read and summarize one dataset cycle's status artifacts."""

    artifacts = ArtifactRepository(store=store, paths=paths)
    return summarize_cycle_progress(
        artifact_root_uri=paths.artifact_root_uri,
        dataset_id=model.id,
        cycle=cycle,
        artifact_ids=model.workload.artifacts,
        frames=model.workload.frames,
        objects=artifacts.list_cycle_run_objects(dataset_id=model.id, cycle=cycle),
        read_json=artifacts.read_json_uri,
        manifest_present=manifest_present,
        missing_sample_limit=missing_sample_limit,
        marker_validation_sample_limit=marker_validation_sample_limit,
    )


def _invalid_marker_sample(
    *,
    read_json: Callable[[str], Mapping[str, Any]],
    marker_by_id: dict[str, _ArtifactListing],
    found: set[str],
    limit: int,
) -> list[str]:
    invalid: list[str] = []
    for marker_id in sorted(found)[:limit]:
        obj = marker_by_id[marker_id]
        try:
            parse_artifact_success_marker(read_json(obj.uri), uri=obj.uri)
        except (Exception, SystemExit):
            invalid.append(marker_id)
    return invalid


def _latest_modified(values: Iterable[datetime | None]) -> datetime | None:
    concrete = [value for value in values if value is not None]
    return max(concrete) if concrete else None
