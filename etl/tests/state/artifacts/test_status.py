from __future__ import annotations

from datetime import datetime, timezone

import pytest
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.state.artifacts.status import (
    read_cycle_progress,
    success_marker_id_from_key,
    summarize_cycle_progress,
)
from weather_etl.storage.base import UriObject

from tests.fixtures.artifacts import (
    DEFAULT_RUN_ID,
    invalid_success_marker_payload,
    success_marker_payload_from_uri,
    temp_artifact_fixture,
)
from tests.fixtures.pipeline import minimal_pipeline_config

OTHER_RUN_ID = "20260411T010000Z-00000001"


def test_success_marker_id_from_key_accepts_valid_marker() -> None:
    marker_id = success_marker_id_from_key(
        dataset_id="gfs",
        cycle="2026051106",
        key=f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json",
    )

    assert marker_id == "tmp_surface/003"


@pytest.mark.parametrize(
    ("key", "run_id"),
    [
        (f"runs/icon/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json", None),
        (f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/003.json", None),
        (f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/publication.json", None),
        (f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/./003._SUCCESS.json", None),
        (f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/.._SUCCESS.json", None),
        (f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json", OTHER_RUN_ID),
    ],
)
def test_success_marker_id_from_key_rejects_non_matching_keys(key: str, run_id: str | None) -> None:
    assert success_marker_id_from_key(
        dataset_id="gfs",
        cycle="2026051106",
        key=key,
        run_id=run_id,
    ) is None


def test_summarize_cycle_progress_reports_complete_published_cycle() -> None:
    modified = datetime(2026, 5, 11, 14, 0, tzinfo=timezone.utc)
    objects = [
        _obj(f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp/000._SUCCESS.json", modified),
        _obj(f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp/003._SUCCESS.json", modified),
        _obj(f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/publication.json", modified),
    ]

    progress = summarize_cycle_progress(
        artifact_root_uri="file:///artifacts",
        dataset_id="gfs",
        cycle="2026051106",
        artifact_ids=("tmp",),
        frames=("000", "003"),
        objects=objects,
        read_json=success_marker_payload_from_uri,
        manifest_present=True,
    )

    assert progress.complete
    assert progress.publication_present
    assert progress.manifest_present
    assert progress.expected_markers == 2
    assert progress.found_markers == 2
    assert progress.missing_markers == 0
    assert progress.last_progress_at == modified
    assert progress.run_id == DEFAULT_RUN_ID


def test_summarize_cycle_progress_reports_missing_markers() -> None:
    objects = [_obj(f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp/000._SUCCESS.json", None)]

    progress = summarize_cycle_progress(
        artifact_root_uri="file:///artifacts",
        dataset_id="gfs",
        cycle="2026051106",
        artifact_ids=("tmp", "rh"),
        frames=("000", "003"),
        objects=objects,
        read_json=success_marker_payload_from_uri,
        missing_sample_limit=2,
    )

    assert not progress.complete
    assert not progress.publication_present
    assert progress.expected_markers == 4
    assert progress.found_markers == 1
    assert progress.missing_markers == 3
    assert progress.missing_sample == ("rh/000", "rh/003")


def test_summarize_cycle_progress_reports_invalid_marker_sample() -> None:
    objects = [_obj(f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp/000._SUCCESS.json", None)]

    progress = summarize_cycle_progress(
        artifact_root_uri="file:///artifacts",
        dataset_id="gfs",
        cycle="2026051106",
        artifact_ids=("tmp",),
        frames=("000",),
        objects=objects,
        read_json=lambda uri: invalid_success_marker_payload(cycle="2026051106", frame_id="000"),
    )

    assert not progress.complete
    assert progress.invalid_marker_sample == ("tmp/000",)


def test_summarize_cycle_progress_uses_latest_valid_run_id_when_run_is_omitted() -> None:
    objects = [
        _obj(f"runs/gfs/2026051106/{DEFAULT_RUN_ID}/status/tmp/000._SUCCESS.json", None),
        _obj(f"runs/gfs/2026051106/{OTHER_RUN_ID}/status/tmp/000._SUCCESS.json", None),
    ]

    progress = summarize_cycle_progress(
        artifact_root_uri="file:///artifacts",
        dataset_id="gfs",
        cycle="2026051106",
        artifact_ids=("tmp",),
        frames=("000",),
        objects=objects,
        read_json=success_marker_payload_from_uri,
    )

    assert progress.complete
    assert progress.run_id == OTHER_RUN_ID
    assert progress.run_count == 2


def test_read_cycle_progress_uses_store_and_artifact_paths() -> None:
    with temp_artifact_fixture() as artifacts:
        dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")
        cycle = "2026051106"
        artifacts.write_success_marker(
            dataset_id=dataset.id,
            cycle=cycle,
            artifact_id="tmp_surface",
            frame_id="000",
        )
        artifacts.write_publication(
            dataset_id=dataset.id,
            cycle=cycle,
            generated_at=datetime(2026, 5, 11, 7, tzinfo=timezone.utc),
        )

        progress = read_cycle_progress(
            store=artifacts.store,
            paths=artifacts.paths,
            dataset_id=dataset.id,
            cycle=cycle,
            artifact_ids=dataset.workload.artifacts,
            frames=dataset.workload.frames,
            manifest_present=True,
        )

    assert progress.complete
    assert progress.publication_present
    assert progress.manifest_present


def _obj(key: str, modified: datetime | None) -> UriObject:
    return UriObject(uri=f"file:///artifacts/{key}", last_modified=modified)
