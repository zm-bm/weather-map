from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.run_plan import (
    frame_state,
    frame_worker,
)
from tests.fixtures.run_plan import (
    run_plan as build_run_plan,
)
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.run_layouts.observed_single_frame import run_target_for_observed_frame
from weather_etl.operations.run_local import run_local
from weather_etl.workers.launch import WorkerLaunchRecord, WorkerLaunchRequest

_RUN_STAGE_COMMANDS = {"init-run", "validate-run", "publish-run"}


def test_run_local_runs_init_planned_workers_validate_and_publish(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)
    plan = build_run_plan(
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
    stage_commands: list[list[str]] = []

    def run_or_print(cmd, *, dry_run):
        assert dry_run is False
        stage_commands.append(cmd)
        return 0

    launched_requests = []

    def launch_many(self, requests, *, dry_run):
        del self
        launched_requests.extend(requests)
        assert dry_run is False
        return _launch_records(requests)

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_local.plan_run", return_value=plan) as plan_run,
        patch("weather_etl.operations.run_local.run_or_print", side_effect=run_or_print),
        patch("weather_etl.operations.run_local.LocalDockerWorkerBackend.launch_many", new=launch_many),
    ):
        result = _run_local(
            fake_env,
            tmp_path,
            selected_frames=("000",),
            selected_artifacts=("tmp_surface",),
            procs=2,
        )[0]

    assert result.ok
    assert result.workers_started == 1
    assert result.workers_skipped == 0
    assert _stage_command_counts(stage_commands) == {
        "init-run": 1,
        "validate-run": 1,
        "publish-run": 1,
    }
    assert [request.worker for request in launched_requests] == list(plan.workers)
    assert plan_run.call_args.kwargs["selected_frames"] == ("000",)
    assert plan_run.call_args.kwargs["selected_artifacts"] == ("tmp_surface",)


def test_run_local_defaults_to_forecast_datasets_with_shared_run_id(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(
        dataset_ids=("gfs", "icon", "mrms"),
        source_types={"mrms": "mrms_aws_s3"},
        frame_start=0,
        frame_end=0,
    )

    def run_or_print(cmd, *, dry_run):
        del dry_run
        return 0

    def plan_run(**kwargs):
        dataset_id = kwargs["dataset_id"]
        worker = frame_worker("000", dataset_id=dataset_id)
        return build_run_plan(
            dataset_id=dataset_id,
            cycle=kwargs["cycle"],
            run_id=kwargs["run_id"],
            workers=(worker,),
            frame_states=(frame_state("000", "pending"),),
            frame_ids=("000",),
            publish=False,
        )

    def launch_many(self, requests, *, dry_run):
        del self
        assert dry_run is False
        assert [request.worker.env["DATASET_ID"] for request in requests] == ["gfs", "icon"]
        return _launch_records(requests)

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch("weather_etl.operations.run_layouts.generate_run_id", return_value=DEFAULT_RUN_ID) as generate_run_id,
        patch("weather_etl.operations.run_local.plan_run", side_effect=plan_run) as plan_run_mock,
        patch("weather_etl.operations.run_local.run_or_print", side_effect=run_or_print),
        patch("weather_etl.operations.run_local.LocalDockerWorkerBackend.launch_many", new=launch_many),
    ):
        results = _run_local(
            fake_env,
            tmp_path,
            dataset_id=None,
            run_id=None,
            publish=False,
        )

    assert [result.dataset_id for result in results] == ["gfs", "icon"]
    assert [result.workers_started for result in results] == [1, 1]
    generate_run_id.assert_called_once_with()
    assert [call.kwargs["run_id"] for call in plan_run_mock.call_args_list] == [DEFAULT_RUN_ID, DEFAULT_RUN_ID]
    assert [call.kwargs["dataset_id"] for call in plan_run_mock.call_args_list] == ["gfs", "icon"]


def test_run_local_requires_cycle_for_forecast_dataset(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=0)

    with patch.object(fake_env, "load_product_config", return_value=product_config):
        try:
            run_local(
                env=fake_env,
                dataset_id="gfs",
                cycle=None,
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
            )
        except SystemExit as exc:
            assert "--cycle is required" in str(exc)
        else:
            raise AssertionError("expected forecast run without --cycle to fail")


def test_run_local_fans_out_mrms_frames_into_deterministic_single_frame_runs(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(
        dataset_id="mrms",
        source_types={"mrms": "mrms_aws_s3"},
        frame_start=0,
        frame_end=0,
    )
    frame_ids = ("20260611000200", "20260611000000")
    ordered_frames = tuple(sorted(frame_ids))
    stage_commands: list[list[str]] = []

    def run_or_print(cmd, *, dry_run):
        assert dry_run is False
        stage_commands.append(cmd)
        return 0

    def plan_run(**kwargs):
        frame_id = kwargs["selected_frames"][0]
        return build_run_plan(
            dataset_id="mrms",
            cycle=kwargs["cycle"],
            run_id=kwargs["run_id"],
            workers=(frame_worker(frame_id=frame_id, dataset_id="mrms"),),
            frame_states=(frame_state(frame_id, "pending"),),
            frame_ids=(frame_id,),
        )

    def launch_many(self, requests, *, dry_run):
        del self
        assert dry_run is False
        assert [request.worker.frame_id for request in requests] == list(ordered_frames)
        return tuple(
            WorkerLaunchRecord(
                worker=request.worker,
                source_uri=request.source_uri,
                started=True,
            )
            for request in requests
        )

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch(
            "weather_etl.operations.run_layouts.observed_single_frame.resolve_source_frame_ids",
            return_value=frame_ids,
        ) as resolve_frames,
        patch("weather_etl.operations.run_local.plan_run", side_effect=plan_run) as plan_run_mock,
        patch("weather_etl.operations.run_local.run_or_print", side_effect=run_or_print),
        patch("weather_etl.operations.run_local.LocalDockerWorkerBackend.launch_many", new=launch_many),
    ):
        results = _run_local(
            fake_env,
            tmp_path,
            dataset_id="mrms",
            cycle=None,
            run_id=None,
            procs=2,
        )

    assert [result.dataset_id for result in results] == ["mrms", "mrms"]
    expected_targets = [
        run_target_for_observed_frame(product_config=product_config, dataset_id="mrms", frame_id=frame)
        for frame in ordered_frames
    ]
    assert [result.cycle for result in results] == [target.cycle for target in expected_targets]
    assert [result.run_id for result in results] == [target.run_id for target in expected_targets]
    assert _stage_command_counts(stage_commands) == {
        "init-run": 2,
        "validate-run": 2,
        "publish-run": 2,
    }
    resolve_frames.assert_called_once()
    assert resolve_frames.call_args.kwargs["selected_frames"] is None
    assert [call.kwargs["selected_frames"] for call in plan_run_mock.call_args_list] == [
        (ordered_frames[0],),
        (ordered_frames[1],),
    ]

    init_commands = [cmd for cmd in stage_commands if "init-run" in cmd]
    assert [_command_arg(cmd, "--frames") for cmd in init_commands] == list(ordered_frames)


def test_run_local_continues_after_one_observed_worker_fails(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(
        dataset_id="mrms",
        source_types={"mrms": "mrms_aws_s3"},
        frame_start=0,
        frame_end=0,
    )
    frame_ids = ("20260611000000", "20260611000200")
    stage_commands: list[list[str]] = []

    def run_or_print(cmd, *, dry_run):
        assert dry_run is False
        stage_commands.append(cmd)
        return 0

    def plan_run(**kwargs):
        frame_id = kwargs["selected_frames"][0]
        return build_run_plan(
            dataset_id="mrms",
            cycle=kwargs["cycle"],
            run_id=kwargs["run_id"],
            workers=(frame_worker(frame_id=frame_id, dataset_id="mrms"),),
            frame_states=(frame_state(frame_id, "pending"),),
            frame_ids=(frame_id,),
        )

    def launch_many(self, requests, *, dry_run):
        del self
        assert dry_run is False
        return (
            WorkerLaunchRecord(
                worker=requests[0].worker,
                source_uri=requests[0].source_uri,
                started=False,
                failed=True,
            ),
            WorkerLaunchRecord(
                worker=requests[1].worker,
                source_uri=requests[1].source_uri,
                started=True,
            ),
        )

    with (
        patch.object(fake_env, "load_product_config", return_value=product_config),
        patch(
            "weather_etl.operations.run_layouts.observed_single_frame.resolve_source_frame_ids",
            return_value=frame_ids,
        ),
        patch("weather_etl.operations.run_local.plan_run", side_effect=plan_run),
        patch("weather_etl.operations.run_local.run_or_print", side_effect=run_or_print),
        patch("weather_etl.operations.run_local.LocalDockerWorkerBackend.launch_many", new=launch_many),
    ):
        results = _run_local(
            fake_env,
            tmp_path,
            dataset_id="mrms",
            cycle=None,
            run_id=None,
            procs=2,
        )

    assert [result.ok for result in results] == [False, True]
    assert [result.failures for result in results] == [1, 0]
    assert [result.workers_started for result in results] == [0, 1]
    assert _stage_command_counts(stage_commands) == {
        "init-run": 2,
        "validate-run": 1,
        "publish-run": 1,
    }


def test_run_local_rejects_run_id_for_mrms(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
    tmp_path: Path,
) -> None:
    product_config = loaded_product_config_factory(
        dataset_id="mrms",
        source_types={"mrms": "mrms_aws_s3"},
        frame_start=0,
        frame_end=0,
    )

    with patch.object(fake_env, "load_product_config", return_value=product_config):
        try:
            run_local(
                env=fake_env,
                dataset_id="mrms",
                cycle=None,
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
            )
        except SystemExit as exc:
            assert "--run-id is not supported" in str(exc)
        else:
            raise AssertionError("expected MRMS run with --run-id to fail")


def _run_local(
    fake_env: EtlEnvironment,
    tmp_path: Path,
    **overrides,
):
    args = {
        "env": fake_env,
        "dataset_id": "gfs",
        "cycle": "2026021300",
        "run_id": DEFAULT_RUN_ID,
        "selected_frames": None,
        "selected_artifacts": None,
        "publish": True,
        "procs": 1,
        "dry_run": False,
        "local_image": "weather-etl:local",
        "artifacts_dir": tmp_path / "artifacts",
        "cache_dir": tmp_path / "cache",
        "worker_stagger_seconds": 0.0,
    }
    args.update(overrides)
    return run_local(**args)


def _stage_command_counts(commands: list[list[str]]) -> dict[str, int]:
    counts = {command: 0 for command in _RUN_STAGE_COMMANDS}
    for command in commands:
        counts[_stage_command_name(command)] += 1
    return counts


def _stage_command_name(cmd: list[str]) -> str:
    return next(item for item in cmd if item in _RUN_STAGE_COMMANDS)


def _command_arg(cmd: list[str], flag: str) -> str:
    return cmd[cmd.index(flag) + 1]


def _launch_records(
    requests: tuple[WorkerLaunchRequest, ...],
    *,
    failed: bool = False,
    started: bool | None = None,
) -> tuple[WorkerLaunchRecord, ...]:
    return tuple(
        WorkerLaunchRecord(
            worker=request.worker,
            source_uri=request.source_uri,
            started=not failed if started is None else started,
            failed=failed,
        )
        for request in requests
    )
