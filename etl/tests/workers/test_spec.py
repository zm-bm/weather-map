from __future__ import annotations

from tests.fixtures.cycle_plan import cycle_plan, frame_worker
from weather_etl.workers.spec import FrameWorkerSpec, worker_spec_hash


def test_worker_spec_hash_is_stable_for_sorted_json_content() -> None:
    left = {"frame_id": "003", "env": {"B": "2", "A": "1"}, "command": ["weather-etl", "run-frame"]}
    right = {"command": ["weather-etl", "run-frame"], "env": {"A": "1", "B": "2"}, "frame_id": "003"}

    assert worker_spec_hash(left) == worker_spec_hash(right)


def test_frame_worker_spec_serializes_hash_over_base_plan() -> None:
    spec = FrameWorkerSpec(
        frame_id="003",
        env={"DATASET_ID": "gfs", "FRAME_ID": "003"},
        command=("weather-etl", "run-frame", "--frame-id", "003"),
    )

    base = spec.base_plan_dict()
    plan = spec.to_plan_dict()

    assert plan == {
        **base,
        "worker_spec_hash": worker_spec_hash(base),
    }


def test_frame_worker_spec_hash_excludes_source_uri() -> None:
    base = FrameWorkerSpec(
        frame_id="003",
        env={"DATASET_ID": "gfs", "FRAME_ID": "003"},
        command=("weather-etl", "run-frame", "--frame-id", "003"),
        source_uri="s3://source/a",
    )
    changed_source = FrameWorkerSpec(
        frame_id="003",
        env={"DATASET_ID": "gfs", "FRAME_ID": "003"},
        command=("weather-etl", "run-frame", "--frame-id", "003"),
        source_uri="s3://source/b",
    )

    assert "source_uri" not in base.base_plan_dict()
    assert base.worker_spec_hash == changed_source.worker_spec_hash


def test_cycle_plan_returns_worker_for_frame() -> None:
    plan = cycle_plan(workers=(frame_worker("003"), frame_worker("006")))

    assert plan.worker_for_frame("006") == plan.workers[1]
    assert plan.worker_for_frame("009") is None
