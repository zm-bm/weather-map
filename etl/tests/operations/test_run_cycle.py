from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.cycle_plan import (
    cycle_plan as build_cycle_plan,
)
from tests.fixtures.cycle_plan import (
    frame_state,
    frame_worker,
    launch_summary,
)
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.run_cycle import run_cycle

_CYCLE_COMMANDS = {"init-run", "validate-cycle", "publish-cycle"}


def test_run_cycle_runs_init_planned_workers_validate_and_publish(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    plan = build_cycle_plan(
        workers=(
            frame_worker(
                frame_id="000",
                env={"ARTIFACT_ROOT_URI": "file:///artifacts"},
                command=("weather-etl", "run-frame", "--dataset-id", "gfs"),
            ),
        ),
        frame_states=(frame_state("000", "pending"),),
        frame_ids=("000",),
    )
    phases: list[str] = []

    def run_or_print(cmd, *, dry_run):
        del dry_run
        phases.append(_stage_command_name(cmd))
        return 0

    def launch_local_docker_plan_workers(**kwargs):
        phases.append("run-workers")
        return launch_summary(kwargs["plan"].workers)

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_cycle.plan_cycle", return_value=plan) as plan_cycle,
        patch("weather_etl.operations.run_cycle.run_or_print", side_effect=run_or_print),
        patch(
            "weather_etl.operations.run_cycle.launch_local_docker_plan_workers",
            side_effect=launch_local_docker_plan_workers,
        ) as launch_workers,
    ):
        result = run_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=("000",),
            selected_artifacts=("tmp_surface",),
            publish=True,
            procs=2,
            dry_run=False,
            local_image="weather-etl:local",
            artifacts_dir=tmp_path / "artifacts",
            cache_dir=tmp_path / "cache",
            worker_stagger_seconds=0.0,
        )[0]

    assert result.ok
    assert result.workers_started == 1
    assert result.workers_skipped == 0
    assert phases == ["init-run", "run-workers", "validate-cycle", "publish-cycle"]
    assert launch_workers.call_args.kwargs["plan"] is plan
    assert plan_cycle.call_args.kwargs["selected_frames"] == ("000",)
    assert plan_cycle.call_args.kwargs["selected_artifacts"] == ("tmp_surface",)


def test_run_cycle_skips_publish_container_when_no_publish(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    plan = build_cycle_plan(
        workers=(),
        frame_states=(frame_state("000", "complete"),),
        frame_ids=("000",),
        publish=False,
    )
    phases: list[str] = []

    def run_or_print(cmd, *, dry_run):
        del dry_run
        phases.append(_stage_command_name(cmd))
        return 0

    def launch_local_docker_plan_workers(**kwargs):
        phases.append("run-workers")
        return launch_summary(kwargs["plan"].workers)

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_cycle.plan_cycle", return_value=plan),
        patch("weather_etl.operations.run_cycle.run_or_print", side_effect=run_or_print),
        patch(
            "weather_etl.operations.run_cycle.launch_local_docker_plan_workers",
            side_effect=launch_local_docker_plan_workers,
        ),
    ):
        result = run_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=None,
            selected_artifacts=None,
            publish=False,
            procs=1,
            dry_run=False,
            local_image="weather-etl:local",
            artifacts_dir=tmp_path / "artifacts",
            cache_dir=tmp_path / "cache",
            worker_stagger_seconds=0.0,
        )[0]

    assert result.ok
    assert phases == ["init-run", "run-workers", "validate-cycle"]


def test_run_cycle_uses_dry_run_for_all_local_commands(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    plan = build_cycle_plan(
        workers=(),
        frame_states=(frame_state("000", "complete"),),
        frame_ids=("000",),
    )

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_cycle.plan_cycle", return_value=plan),
        patch("weather_etl.operations.run_cycle.run_or_print", return_value=0) as run_or_print,
        patch(
            "weather_etl.operations.run_cycle.launch_local_docker_plan_workers",
            return_value=launch_summary(plan.workers, started=False),
        ) as launch_workers,
    ):
        result = run_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=None,
            selected_artifacts=None,
            publish=True,
            procs=1,
            dry_run=True,
            local_image="weather-etl:local",
            artifacts_dir=tmp_path / "artifacts",
            cache_dir=tmp_path / "cache",
            worker_stagger_seconds=0.0,
        )[0]

    assert result.ok
    assert [call.kwargs["dry_run"] for call in run_or_print.call_args_list] == [True, True, True]
    assert launch_workers.call_args.kwargs["dry_run"] is True


def test_run_cycle_returns_failure_when_worker_containers_fail(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    plan = build_cycle_plan(
        workers=(
            frame_worker(
                frame_id="000",
                env={},
                command=("weather-etl", "run-frame", "--dataset-id", "gfs"),
            ),
        ),
        frame_states=(frame_state("000", "pending"),),
        frame_ids=("000",),
    )

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_cycle.plan_cycle", return_value=plan),
        patch("weather_etl.operations.run_cycle.run_or_print", return_value=0),
        patch(
            "weather_etl.operations.run_cycle.launch_local_docker_plan_workers",
            return_value=launch_summary(plan.workers, failed=True),
        ),
    ):
        result = run_cycle(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=DEFAULT_RUN_ID,
            selected_frames=None,
            selected_artifacts=None,
            publish=True,
            procs=1,
            dry_run=False,
            local_image="weather-etl:local",
            artifacts_dir=tmp_path / "artifacts",
            cache_dir=tmp_path / "cache",
            worker_stagger_seconds=0.0,
        )[0]

    assert not result.ok
    assert result.workers_started == 0
    assert result.failures == 1


def test_run_cycle_generates_one_run_id_for_all_selected_datasets(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(dataset_ids=("gfs", "icon"), frame_start=0, frame_end=0)
    plan = build_cycle_plan(
        workers=(),
        frame_states=(frame_state("000", "complete"),),
        frame_ids=("000",),
        publish=False,
    )

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_cycle.generate_run_id", return_value=DEFAULT_RUN_ID) as generate_run_id,
        patch("weather_etl.operations.run_cycle.plan_cycle", return_value=plan) as plan_cycle,
        patch("weather_etl.operations.run_cycle.run_or_print", return_value=0),
        patch(
            "weather_etl.operations.run_cycle.launch_local_docker_plan_workers",
            return_value=launch_summary(plan.workers),
        ),
    ):
        results = run_cycle(
            env=fake_env,
            dataset_id=None,
            cycle="2026021300",
            run_id=None,
            selected_frames=None,
            selected_artifacts=None,
            publish=False,
            procs=1,
            dry_run=False,
            local_image="weather-etl:local",
            artifacts_dir=tmp_path / "artifacts",
            cache_dir=tmp_path / "cache",
            worker_stagger_seconds=0.0,
        )

    assert [result.dataset_id for result in results] == ["gfs", "icon"]
    generate_run_id.assert_called_once_with()
    assert [call.kwargs["run_id"] for call in plan_cycle.call_args_list] == [DEFAULT_RUN_ID, DEFAULT_RUN_ID]


def _stage_command_name(cmd: list[str]) -> str:
    return next(item for item in cmd if item in _CYCLE_COMMANDS)
