from __future__ import annotations

import json

from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.state.runs.completion import inspect_frame_completion
from weather_etl.state.runs.snapshots import LoadedRunSnapshot

from tests.fixtures.markers import write_json
from tests.fixtures.pipeline import loaded_run_snapshot, raw_pipeline_config
from tests.fixtures.publish import publish_fixture


def test_frame_completion_is_pending_without_markers() -> None:
    with publish_fixture(prefix="weather-map-completion-pending-") as fx:
        completion = inspect_frame_completion(
            artifact_repo=fx.artifacts,
            dataset=_dataset(),
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
            frame_id="000",
            artifact_ids=("tmp_surface",),
        )

    assert completion.state == "pending"
    assert completion.expected_marker_count == 1
    assert completion.observed_marker_count == 0
    assert completion.missing_markers
    assert completion.errors == ()


def test_frame_completion_is_complete_with_valid_markers() -> None:
    with publish_fixture(prefix="weather-map-completion-complete-") as fx:
        fx.write_scalar_marker()

        completion = inspect_frame_completion(
            artifact_repo=fx.artifacts,
            dataset=_dataset(),
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
            frame_id="000",
            artifact_ids=("tmp_surface",),
        )

    assert completion.state == "complete"
    assert completion.expected_marker_count == 1
    assert completion.observed_marker_count == 1
    assert completion.missing_markers == ()
    assert completion.errors == ()


def test_frame_completion_is_missing_with_partial_markers() -> None:
    with publish_fixture(prefix="weather-map-completion-missing-") as fx:
        fx.write_scalar_marker(artifact_id="tmp_surface")

        completion = inspect_frame_completion(
            artifact_repo=fx.artifacts,
            dataset=_dataset(artifacts=("tmp_surface", "rh_surface")),
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id, artifacts=("tmp_surface", "rh_surface")),
            frame_id="000",
            artifact_ids=("tmp_surface", "rh_surface"),
        )

    assert completion.state == "missing"
    assert completion.expected_marker_count == 2
    assert completion.observed_marker_count == 1
    assert len(completion.missing_markers) == 1
    assert "/status/rh_surface/000._SUCCESS.json" in completion.missing_markers[0]
    assert completion.errors == ()


def test_frame_completion_is_invalid_with_malformed_marker() -> None:
    with publish_fixture(prefix="weather-map-completion-malformed-") as fx:
        fx.write_scalar_marker()
        marker_uri = fx.marker_uri("tmp_surface")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        del marker["artifact"]["sha256"]
        write_json(marker_uri, marker)

        completion = inspect_frame_completion(
            artifact_repo=fx.artifacts,
            dataset=_dataset(),
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
            frame_id="000",
            artifact_ids=("tmp_surface",),
        )

    assert completion.state == "invalid"
    assert any("invalid success marker" in error for error in completion.errors)


def test_frame_completion_is_invalid_with_marker_metadata_mismatch() -> None:
    with publish_fixture(prefix="weather-map-completion-mismatch-") as fx:
        fx.write_scalar_marker()
        marker_uri = fx.marker_uri("tmp_surface")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker["artifact"]["payload_uri"] = "file:///wrong/path.bin"
        write_json(marker_uri, marker)

        completion = inspect_frame_completion(
            artifact_repo=fx.artifacts,
            dataset=_dataset(),
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
            frame_id="000",
            artifact_ids=("tmp_surface",),
        )

    assert completion.state == "invalid"
    assert any("artifact metadata payload_uri mismatch" in error for error in completion.errors)


def test_frame_completion_is_invalid_with_unknown_selected_artifact() -> None:
    with publish_fixture(prefix="weather-map-completion-unknown-artifact-") as fx:
        completion = inspect_frame_completion(
            artifact_repo=fx.artifacts,
            dataset=_dataset(),
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
            frame_id="000",
            artifact_ids=("missing_surface",),
        )

    assert completion.state == "invalid"
    assert completion.expected_marker_count == 1
    assert completion.observed_marker_count == 0
    assert any("missing artifact config for workload artifact: 'missing_surface'" in error for error in completion.errors)


def _dataset(*, artifacts: tuple[str, ...] = ("tmp_surface",)):
    return parse_pipeline_config(raw_pipeline_config(artifacts=artifacts)).dataset("gfs")


def _snapshot(
    *,
    cycle: str,
    run_id: str,
    artifacts: tuple[str, ...] = ("tmp_surface",),
) -> LoadedRunSnapshot:
    return loaded_run_snapshot(
        cycle=cycle,
        run_id=run_id,
        artifacts=artifacts,
        artifact_root_uri="file:///artifacts",
    )
