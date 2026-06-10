from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.core.cycles import cycle_datetime
from weather_etl.state.inspection.freshness import (
    PublishLagPolicy,
    _read_dataset_artifact_snapshot,
    _select_target_cycle,
    estimate_publish_lag,
    inspect_dataset_freshness,
)
from weather_etl.state.manifest.schema import parse_cycle_manifest

from tests.fixtures.artifacts import DEFAULT_RUN_ID, manifest_payload, temp_artifact_fixture
from tests.fixtures.pipeline import minimal_pipeline_config

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)
CURRENT_CYCLE = "2026051112"
STALE_CYCLE = "2026051106"


class CountingStore:
    name = "counting"

    def __init__(self, delegate) -> None:
        self.delegate = delegate
        self.list_object_prefixes: list[str] = []

    def __getattr__(self, name: str):
        return getattr(self.delegate, name)

    def read_bytes(self, *, uri: str):
        return self.delegate.read_bytes(uri=uri)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        return self.delegate.write_bytes(uri=uri, data=data)

    def exists(self, *, uri: str):
        return self.delegate.exists(uri=uri)

    def list_prefix(self, *, prefix_uri: str):
        return self.delegate.list_prefix(prefix_uri=prefix_uri)

    def list_objects(self, *, prefix_uri: str):
        self.list_object_prefixes.append(prefix_uri)
        return self.delegate.list_objects(prefix_uri=prefix_uri)

    def get_to_file(self, *, uri: str, dst):
        return self.delegate.get_to_file(uri=uri, dst=dst)

    def put_file(self, *, uri: str, src):
        return self.delegate.put_file(uri=uri, src=src)


def test_current_latest_manifest_returns_fresh_without_reading_status_markers() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = _dataset()
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=CURRENT_CYCLE,
            generated_at=cycle_datetime(CURRENT_CYCLE) + timedelta(hours=1),
        )
        store = CountingStore(artifacts.store)

        freshness = inspect_dataset_freshness(
            store=store,
            paths=artifacts.paths,
            dataset=dataset,
            now=NOW,
            history_cycle_count=4,
            status_cycle_count=4,
            publish_lag_policy=_policy(),
            recent_progress_hours=2,
        )

    assert freshness.status == "fresh"
    assert freshness.reason == "Latest expected cycle is published."
    assert freshness.expected_cycle == CURRENT_CYCLE
    assert freshness.progress is None
    assert freshness.publish_lag.source == "latest-manifest"
    assert freshness.lifecycle_stage == "missing_snapshot"
    assert freshness.lifecycle_cycle == CURRENT_CYCLE
    assert freshness.lifecycle_run_id == DEFAULT_RUN_ID
    assert not [prefix for prefix in store.list_object_prefixes if "/status/" in prefix]


def test_stale_latest_with_recent_partial_markers_returns_building() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = _dataset()
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=STALE_CYCLE,
            generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
        )
        _write_success_markers(
            artifacts,
            dataset=dataset,
            cycle=CURRENT_CYCLE,
            count=2,
            modified=NOW - timedelta(minutes=10),
        )

        freshness = _inspect(artifacts, dataset=dataset)

    assert freshness.status == "building"
    assert freshness.progress is not None
    assert freshness.progress.found_markers == 2
    assert freshness.progress.missing_markers == 2


def test_stale_latest_with_old_partial_markers_returns_stalled() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = _dataset()
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=STALE_CYCLE,
            generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
        )
        _write_success_markers(
            artifacts,
            dataset=dataset,
            cycle=CURRENT_CYCLE,
            count=2,
            modified=NOW - timedelta(hours=4),
        )

        freshness = _inspect(artifacts, dataset=dataset)

    assert freshness.status == "stalled"


def test_stale_latest_with_invalid_current_marker_returns_incomplete() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = _dataset()
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=STALE_CYCLE,
            generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
        )
        artifacts.write_invalid_success_marker(
            dataset_id=dataset.id,
            cycle=CURRENT_CYCLE,
            artifact_id="tmp_surface",
            frame_id="000",
            modified=NOW,
        )

        freshness = _inspect(artifacts, dataset=dataset)

    assert freshness.status == "incomplete"
    assert freshness.reason == "One or more success markers could not be parsed."
    assert freshness.progress is not None
    assert freshness.progress.invalid_marker_sample == ("tmp_surface/000",)


def test_stale_latest_without_current_progress_returns_stale_without_lifecycle_stage() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = _dataset()
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=STALE_CYCLE,
            generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
        )

        freshness = _inspect(artifacts, dataset=dataset)

    assert freshness.status == "stale"
    assert freshness.lifecycle_stage is None
    assert freshness.lifecycle_cycle is None
    assert freshness.lifecycle_run_id is None


def test_no_latest_history_or_status_returns_unavailable() -> None:
    with temp_artifact_fixture() as artifacts:
        freshness = _inspect(artifacts, dataset=_dataset())

    assert freshness.status == "unavailable"
    assert freshness.reason == "No latest manifest or status artifacts were found."
    assert freshness.publish_lag.source == "fallback"


def test_lifecycle_stage_is_attached_for_selected_progress_run() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = _dataset()
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=STALE_CYCLE,
            generated_at=cycle_datetime(STALE_CYCLE) + timedelta(hours=1),
        )
        _write_success_markers(artifacts, dataset=dataset, cycle=CURRENT_CYCLE, count=2, modified=NOW)
        _write_placeholder_run_metadata(artifacts, dataset_id=dataset.id, cycle=CURRENT_CYCLE, run_id=DEFAULT_RUN_ID)

        with patch(
            "weather_etl.state.inspection.freshness.inspect_run_lifecycle",
            return_value=SimpleNamespace(stage="pending_frames"),
        ) as inspect_lifecycle:
            freshness = _inspect(artifacts, dataset=dataset)

    assert freshness.status == "building"
    assert freshness.lifecycle_stage == "pending_frames"
    assert freshness.lifecycle_cycle == CURRENT_CYCLE
    assert freshness.lifecycle_run_id == DEFAULT_RUN_ID
    assert inspect_lifecycle.call_args.kwargs["cycle"] == CURRENT_CYCLE
    assert inspect_lifecycle.call_args.kwargs["run_id"] == DEFAULT_RUN_ID


def test_estimate_publish_lag_uses_recent_manifest_history() -> None:
    estimate = estimate_publish_lag(
        manifests=(
            _manifest("2026051106", datetime(2026, 5, 11, 8, tzinfo=timezone.utc)),
            _manifest("2026051112", datetime(2026, 5, 11, 13, tzinfo=timezone.utc)),
        ),
        policy=_policy(),
    )

    assert estimate.source == "recent-history"
    assert estimate.hours == 3


def test_estimate_publish_lag_falls_back_without_history() -> None:
    estimate = estimate_publish_lag(manifests=(), policy=_policy())

    assert estimate.source == "fallback"
    assert estimate.hours == 9


def test_select_target_cycle_prefers_newer_observed_cycle() -> None:
    assert _select_target_cycle(
        expected_cycle="2026051112",
        latest_observed_cycle="2026051118",
        latest_published_cycle="2026051106",
    ) == "2026051118"


def test_read_dataset_artifact_snapshot_reads_complete_cycle() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")
        cycle = "2026051112"
        generated_at = datetime(2026, 5, 11, 13, tzinfo=timezone.utc)
        manifest_uri = artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle=cycle,
            generated_at=generated_at,
        )
        artifacts.write_success_marker(
            dataset_id=dataset.id,
            cycle=cycle,
            artifact_id="tmp_surface",
            frame_id="000",
        )
        artifacts.write_publication(
            dataset_id=dataset.id,
            cycle=cycle,
            generated_at=generated_at,
            manifest_path=artifacts.paths.relative_key(manifest_uri),
        )

        snapshot = _read_dataset_artifact_snapshot(
            store=artifacts.store,
            paths=artifacts.paths,
            dataset=dataset,
            now=NOW,
            history_cycle_count=4,
            status_cycle_count=4,
            publish_lag_policy=_policy(),
        )

    assert snapshot.expected_cycle == cycle
    assert snapshot.latest_observed_cycle == cycle
    assert snapshot.latest_published_cycle == cycle
    assert snapshot.latest_published_generated_at == generated_at
    assert snapshot.progress.complete
    assert snapshot.progress.publication_present
    assert snapshot.progress.manifest_present
    assert snapshot.publish_lag.source == "recent-history"


def test_read_dataset_artifact_snapshot_does_not_scan_old_manifest_status_cycles() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")
        for cycle in ("2026051100", "2026051106"):
            artifacts.write_manifest(
                dataset_id=dataset.id,
                cycle=cycle,
                generated_at=cycle_datetime(cycle) + timedelta(hours=1),
                latest=False,
            )
        artifacts.write_manifest(
            dataset_id=dataset.id,
            cycle="2026051112",
            generated_at=datetime(2026, 5, 11, 13, tzinfo=timezone.utc),
        )
        store = CountingStore(artifacts.store)

        _read_dataset_artifact_snapshot(
            store=store,
            paths=artifacts.paths,
            dataset=dataset,
            now=NOW,
            history_cycle_count=4,
            status_cycle_count=4,
            publish_lag_policy=_policy(),
        )

    run_prefixes = [prefix for prefix in store.list_object_prefixes if "/runs/" in prefix]
    assert artifacts.paths.cycle_runs_prefix_uri(dataset_id=dataset.id, cycle="2026051112") in run_prefixes
    assert artifacts.paths.cycle_runs_prefix_uri(dataset_id=dataset.id, cycle="2026051100") not in run_prefixes
    assert artifacts.paths.cycle_runs_prefix_uri(dataset_id=dataset.id, cycle="2026051106") not in run_prefixes


def _dataset():
    cfg = minimal_pipeline_config()
    cfg["datasets"]["gfs"]["workload"]["frame_end"] = 3
    return parse_pipeline_config(cfg).dataset("gfs")


def _inspect(artifacts, *, dataset):
    return inspect_dataset_freshness(
        store=artifacts.store,
        paths=artifacts.paths,
        dataset=dataset,
        now=NOW,
        history_cycle_count=4,
        status_cycle_count=4,
        publish_lag_policy=_policy(),
        recent_progress_hours=2,
    )


def _write_success_markers(artifacts, *, dataset, cycle: str, count: int, modified: datetime) -> None:
    marker_ids = [
        (artifact_id, frame_id)
        for artifact_id in dataset.workload.artifacts
        for frame_id in dataset.workload.frames
    ]
    for artifact_id, frame_id in marker_ids[:count]:
        artifacts.write_success_marker(
            dataset_id=dataset.id,
            cycle=cycle,
            artifact_id=artifact_id,
            frame_id=frame_id,
            modified=modified,
        )


def _write_placeholder_run_metadata(artifacts, *, dataset_id: str, cycle: str, run_id: str) -> None:
    artifacts.store.write_bytes(
        uri=artifacts.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
        data=b"{}",
    )


def _policy() -> PublishLagPolicy:
    return PublishLagPolicy(
        fallback_hours=9,
        cushion_hours=1,
        min_hours=3,
        max_hours=12,
    )


def _manifest(cycle: str, generated_at: datetime):
    return parse_cycle_manifest(manifest_payload(cycle=cycle, generated_at=generated_at))
