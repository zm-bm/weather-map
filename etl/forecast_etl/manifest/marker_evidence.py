"""Success-marker evidence collection for publication."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ..artifacts.markers_schema import ArtifactSuccessMarker, parse_artifact_success_marker
from ..artifacts.repository import ArtifactRepository
from ..run_ids import validate_run_id


@dataclass(frozen=True)
class PublishMarkerEvidence:
    """Publication-ready success-marker evidence."""

    ready: bool
    marker_cache: dict[tuple[str, str], ArtifactSuccessMarker]
    missing_markers: tuple[str, ...] = ()
    marker_errors: tuple[str, ...] = ()


def collect_publish_marker_evidence(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: tuple[str, ...],
    artifact_ids: tuple[str, ...],
) -> PublishMarkerEvidence:
    """Collect and validate expected success markers for publication."""

    missing = artifact_repo.missing_success_markers(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frames=frames,
        artifact_ids=artifact_ids,
    )
    if missing:
        print(f"Publish not ready: missing {len(missing)} success markers")
        for marker in missing[:10]:
            print(f"missing: {marker}")
        if len(missing) > 10:
            print(f"... and {len(missing) - 10} more")
        return PublishMarkerEvidence(ready=False, marker_cache={}, missing_markers=tuple(missing))

    expected_marker_count = len(frames) * len(artifact_ids)
    print(
        f"Publish reading {expected_marker_count} success markers "
        f"dataset_id={dataset_id} cycle={cycle} run_id={run_id}",
        flush=True,
    )
    marker_cache, marker_errors = _read_publish_markers(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frames=frames,
        artifact_ids=artifact_ids,
        required_run_id=run_id,
    )
    if marker_errors:
        print(f"Publish not ready: run id marker validation failed for {len(marker_errors)} marker(s)")
        for error in marker_errors[:10]:
            print(f"marker error: {error}")
        if len(marker_errors) > 10:
            print(f"... and {len(marker_errors) - 10} more")
        return PublishMarkerEvidence(
            ready=False,
            marker_cache=marker_cache,
            marker_errors=tuple(marker_errors),
        )
    return PublishMarkerEvidence(ready=True, marker_cache=marker_cache)


def _read_publish_markers(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: tuple[str, ...],
    artifact_ids: tuple[str, ...],
    required_run_id: str | None,
) -> tuple[dict[tuple[str, str], ArtifactSuccessMarker], list[str]]:
    """Read expected markers once and require one consistent run id."""

    markers: dict[tuple[str, str], ArtifactSuccessMarker] = {}
    run_ids: set[str] = set()
    errors: list[str] = []
    for artifact_id in artifact_ids:
        for frame_id in frames:
            uri = artifact_repo.paths.success_marker_uri_parts(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
            )
            try:
                raw_marker = artifact_repo.read_json_uri(uri)
            except (Exception, SystemExit) as exc:
                errors.append(f"{uri}: {exc}")
                continue
            raw_run_id = raw_marker.get("run_id") if isinstance(raw_marker, Mapping) else None
            if not isinstance(raw_run_id, str) or not raw_run_id.strip():
                errors.append(f"{uri}: missing run_id")
                continue
            try:
                marker_run_id = validate_run_id(raw_run_id)
                run_ids.add(marker_run_id)
                markers[(artifact_id, frame_id)] = parse_artifact_success_marker(raw_marker, uri=uri)
            except ValueError as exc:
                errors.append(f"{uri}: {exc}")

    if required_run_id is not None and run_ids and run_ids != {required_run_id}:
        errors.append(
            f"success markers run_id mismatch: expected={required_run_id!r} found={sorted(run_ids)!r}"
        )
    if len(run_ids) > 1:
        errors.append(f"success markers contain multiple run_id values: {sorted(run_ids)!r}")
    if errors:
        return markers, errors
    if required_run_id is not None and not run_ids:
        return markers, [f"success markers missing required run_id {required_run_id!r}"]
    return markers, []
