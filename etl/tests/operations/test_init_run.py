from __future__ import annotations

from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.pipeline import loaded_product_config
from weather_etl.config.sources import MRMS_AWS_S3_SOURCE_TYPE
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.init_run import init_run
from weather_etl.operations.run_layouts.observed_single_frame import run_target_for_observed_frame


def _mrms_product_config():
    return loaded_product_config(
        dataset_id="mrms",
        source_types={"mrms": MRMS_AWS_S3_SOURCE_TYPE},
    )


def test_init_run_creates_or_verifies_snapshot(fake_env: EtlEnvironment, loaded_run_snapshot_factory) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026021300")
    product_config = loaded_product_config()

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch.object(type(fake_env.artifact_repo), "ensure_run_snapshot") as ensure_run_snapshot,
        patch.object(fake_env, "load_run_snapshot", return_value=loaded_snapshot) as load_run_snapshot,
    ):
        result = init_run(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
        )

    assert result is loaded_snapshot
    assert ensure_run_snapshot.call_args.kwargs["dataset_id"] == "gfs"
    assert ensure_run_snapshot.call_args.kwargs["cycle"] == "2026021300"
    assert ensure_run_snapshot.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
    assert load_run_snapshot.call_args.kwargs["dataset_id"] == "gfs"
    assert load_run_snapshot.call_args.kwargs["cycle"] == "2026021300"
    assert load_run_snapshot.call_args.kwargs["run_id"] == DEFAULT_RUN_ID


def test_init_run_pins_mrms_snapshot_to_one_deterministic_frame(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    frame_id = "20260611000000"
    product_config = _mrms_product_config()
    target = run_target_for_observed_frame(product_config=product_config, dataset_id="mrms", frame_id=frame_id)
    cycle = target.cycle
    run_id = target.run_id
    loaded_snapshot = loaded_run_snapshot_factory(dataset_id="mrms", cycle=cycle, run_id=run_id)

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch.object(type(fake_env.artifact_repo), "ensure_run_snapshot") as ensure_run_snapshot,
        patch.object(fake_env, "load_run_snapshot", return_value=loaded_snapshot) as load_run_snapshot,
    ):
        result = init_run(
            env=fake_env,
            dataset_id="mrms",
            cycle=cycle,
            run_id=run_id,
            selected_frames=(frame_id,),
        )

    assert result is loaded_snapshot
    snapshot = ensure_run_snapshot.call_args.kwargs["snapshot"]
    assert ensure_run_snapshot.call_args.kwargs["dataset_id"] == "mrms"
    assert ensure_run_snapshot.call_args.kwargs["cycle"] == cycle
    assert ensure_run_snapshot.call_args.kwargs["run_id"] == run_id
    assert snapshot.pipeline["datasets"]["mrms"]["workload"] == {"frames": [frame_id]}
    assert load_run_snapshot.call_args.kwargs["dataset_id"] == "mrms"
    assert load_run_snapshot.call_args.kwargs["cycle"] == cycle
    assert load_run_snapshot.call_args.kwargs["run_id"] == run_id


def test_init_run_rejects_mrms_run_id_mismatch(fake_env: EtlEnvironment) -> None:
    product_config = _mrms_product_config()

    with patch.object(fake_env, "load_product_config", return_value=product_config):
        try:
            init_run(
                env=fake_env,
                dataset_id="mrms",
                cycle="2026061100",
                run_id=DEFAULT_RUN_ID,
                selected_frames=("20260611000000",),
            )
        except SystemExit as exc:
            assert "deterministic run_id" in str(exc)
        else:
            raise AssertionError("expected MRMS run_id mismatch to fail")
