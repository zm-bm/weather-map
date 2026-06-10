"""Success-marker collection for publication."""

from __future__ import annotations

from dataclasses import dataclass

from ..artifacts.markers_schema import ArtifactSuccessMarker
from ..artifacts.repository import ArtifactRepository


@dataclass(frozen=True)
class PublishMarkerSet:
    """Publication-ready success-marker set."""

    ready: bool
    marker_cache: dict[tuple[str, str], ArtifactSuccessMarker]
    missing_markers: tuple[str, ...] = ()
    marker_errors: tuple[str, ...] = ()


def collect_publish_markers(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: tuple[str, ...],
    artifact_ids: tuple[str, ...],
) -> PublishMarkerSet:
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
        return PublishMarkerSet(ready=False, marker_cache={}, missing_markers=tuple(missing))

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
    )
    if marker_errors:
        print(f"Publish not ready: success marker validation failed for {len(marker_errors)} marker(s)")
        for error in marker_errors[:10]:
            print(f"marker error: {error}")
        if len(marker_errors) > 10:
            print(f"... and {len(marker_errors) - 10} more")
        return PublishMarkerSet(
            ready=False,
            marker_cache=marker_cache,
            marker_errors=tuple(marker_errors),
        )
    return PublishMarkerSet(ready=True, marker_cache=marker_cache)


def _read_publish_markers(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frames: tuple[str, ...],
    artifact_ids: tuple[str, ...],
) -> tuple[dict[tuple[str, str], ArtifactSuccessMarker], list[str]]:
    """Read expected markers once and require one consistent run id."""

    markers: dict[tuple[str, str], ArtifactSuccessMarker] = {}
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
                marker = artifact_repo.read_artifact_success_marker_uri(uri)
            except SystemExit as exc:
                errors.append(f"{uri}: {_publish_marker_parse_error(exc)}")
                continue
            try:
                _assert_expected_marker_identity(
                    marker=marker,
                    uri=uri,
                    dataset_id=dataset_id,
                    cycle=cycle,
                    run_id=run_id,
                    frame_id=frame_id,
                    artifact_id=artifact_id,
                )
            except ValueError as exc:
                errors.append(f"{uri}: {exc}")
                continue
            markers[(artifact_id, frame_id)] = marker

    if errors:
        return markers, errors
    return markers, []


def _assert_expected_marker_identity(
    *,
    marker: ArtifactSuccessMarker,
    uri: str,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    artifact_id: str,
) -> None:
    """Fail hard when a marker at an expected path identifies a different item."""

    actual = {
        "dataset_id": marker.dataset_id,
        "cycle": marker.cycle,
        "run_id": marker.run_id,
        "frame_id": marker.frame_id,
        "artifact_id": marker.artifact_id,
    }
    expected = {
        "dataset_id": dataset_id,
        "cycle": cycle,
        "run_id": run_id,
        "frame_id": frame_id,
        "artifact_id": artifact_id,
    }
    for field, expected_value in expected.items():
        actual_value = actual[field]
        if actual_value != expected_value:
            if field == "run_id":
                raise ValueError(
                    "success markers run_id mismatch: "
                    f"expected={expected_value!r} found={[actual_value]!r}; "
                    f"success markers contain multiple run_id values: {sorted({actual_value, expected_value})!r}"
                )
            raise SystemExit(
                f"Success marker {field} mismatch in marker {uri}: "
                f"marker={actual_value!r} expected={expected_value!r}"
            )


def _publish_marker_parse_error(exc: SystemExit) -> str:
    message = str(exc)
    if "run_id" in message and "Field required" in message:
        return "missing run_id"
    return message
