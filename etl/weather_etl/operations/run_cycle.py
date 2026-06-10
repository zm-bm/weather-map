"""Run dataset cycles locally with planned Docker workers."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..config.product import LoadedProductConfig
from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..state.runs.ids import generate_run_id, parse_run_id
from ..workers.backends.local_docker import (
    container_uri,
    launch_local_docker_plan_workers,
    local_container_cmd,
    run_or_print,
)
from ..workers.claims.store import NullFrameClaimStore
from ..workers.plan import CyclePlan
from .plan_cycle import plan_cycle


@dataclass(frozen=True)
class LocalCycleRunResult:
    """Local lifecycle summary for one dataset cycle."""

    ok: bool
    dataset_id: str
    cycle: str
    run_id: str
    workers_started: int
    workers_skipped: int
    failures: int = 0


@dataclass(frozen=True)
class _LocalLauncher:
    local_image: str
    artifacts_dir: Path
    cache_dir: Path
    procs: int
    dry_run: bool
    worker_stagger_seconds: float


def run_cycle(
    *,
    env: EtlEnvironment,
    dataset_id: str | None,
    cycle: str,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    publish: bool,
    procs: int,
    dry_run: bool,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path,
    worker_stagger_seconds: float,
) -> list[LocalCycleRunResult]:
    """Run the local cycle lifecycle using the production worker image."""

    parse_cycle(cycle)
    resolved_run_id = parse_run_id(run_id) if run_id else generate_run_id()
    product_config = env.load_product_config()
    launcher = _LocalLauncher(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=cache_dir,
        procs=procs,
        dry_run=dry_run,
        worker_stagger_seconds=worker_stagger_seconds,
    )
    return [
        _run_local_dataset_cycle(
            env=env,
            dataset_id=current_dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
            selected_frames=selected_frames,
            selected_artifacts=selected_artifacts,
            publish=publish,
            launcher=launcher,
        )
        for current_dataset_id in _selected_dataset_ids(product_config, dataset_id)
    ]


def _run_local_dataset_cycle(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    publish: bool,
    launcher: _LocalLauncher,
) -> LocalCycleRunResult:
    print(f"Initializing local run snapshot: dataset_id={dataset_id} cycle={cycle}", flush=True)
    init_status = _run_cycle_stage(
        launcher=launcher,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        command_name="init-run",
    )
    if launcher.dry_run:
        _print_dry_run_snapshot_uris(env=env, launcher=launcher, dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    elif init_status != 0:
        return _cycle_result(
            dataset_id,
            cycle,
            run_id,
            workers_started=0,
            workers_skipped=0,
            failures=1,
        )

    plan = plan_cycle(
        env=env,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        selected_frames=selected_frames,
        selected_artifacts=selected_artifacts,
        publish=publish,
        claim_store=NullFrameClaimStore(),
    )
    workers_skipped = len(plan.frame_states) - len(plan.workers)
    _print_plan_summary(plan=plan, workers_skipped=workers_skipped, launcher=launcher, publish=publish)

    launch_summary = launch_local_docker_plan_workers(
        plan=plan,
        claim_store=NullFrameClaimStore(),
        now=datetime.now(timezone.utc),
        local_image=launcher.local_image,
        artifacts_dir=launcher.artifacts_dir,
        cache_dir=launcher.cache_dir,
        procs=launcher.procs,
        worker_stagger_seconds=launcher.worker_stagger_seconds,
        dry_run=launcher.dry_run,
    )
    if launch_summary.failures:
        return _cycle_result(
            dataset_id,
            cycle,
            run_id,
            workers_started=0,
            workers_skipped=workers_skipped,
            failures=launch_summary.failures,
        )

    print(f"Validating local cycle: dataset_id={dataset_id} cycle={cycle}", flush=True)
    validate_status = _run_cycle_stage(
        launcher=launcher,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        command_name="validate-cycle",
    )
    if validate_status != 0:
        return _cycle_result(
            dataset_id,
            cycle,
            run_id,
            workers_started=launch_summary.workers_started,
            workers_skipped=workers_skipped,
            failures=1,
        )

    if publish:
        print(f"Publishing local cycle manifest: dataset_id={dataset_id} cycle={cycle}", flush=True)
        publish_status = _run_cycle_stage(
            launcher=launcher,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            command_name="publish-cycle",
        )
        if publish_status != 0:
            return _cycle_result(
                dataset_id,
                cycle,
                run_id,
                workers_started=launch_summary.workers_started,
                workers_skipped=workers_skipped,
                failures=1,
            )

    return _cycle_result(
        dataset_id,
        cycle,
        run_id,
        ok=True,
        workers_started=launch_summary.workers_started,
        workers_skipped=workers_skipped,
    )


def _selected_dataset_ids(product_config: LoadedProductConfig, dataset_id: str | None) -> tuple[str, ...]:
    if dataset_id:
        product_config.dataset(dataset_id)
        return (dataset_id,)
    return tuple(product_config.pipeline_config.datasets)


def _print_dry_run_snapshot_uris(
    *,
    env: EtlEnvironment,
    launcher: _LocalLauncher,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> None:
    print(
        "  pipeline_uri: "
        + container_uri(
            env.artifact_repo.paths.run_pipeline_uri(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
            ),
            artifacts_dir=launcher.artifacts_dir,
        ),
        flush=True,
    )
    print(
        "  catalog_uri: "
        + container_uri(
            env.artifact_repo.paths.run_catalog_uri(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
            ),
            artifacts_dir=launcher.artifacts_dir,
        ),
        flush=True,
    )


def _print_plan_summary(
    *,
    plan: CyclePlan,
    workers_skipped: int,
    launcher: _LocalLauncher,
    publish: bool,
) -> None:
    print("Running local containerized pipeline", flush=True)
    print(f"  dataset_id:     {plan.dataset_id}", flush=True)
    print(f"  cycle:          {plan.cycle}", flush=True)
    print(f"  run_id:         {plan.run_id}", flush=True)
    print(f"  frames: {len(plan.frame_ids)}", flush=True)
    print(f"  workers: {len(plan.workers)}", flush=True)
    print(f"  skipped: {workers_skipped}", flush=True)
    print(f"  procs:          {launcher.procs}", flush=True)
    print(f"  dry_run:        {launcher.dry_run}", flush=True)
    print(f"  no_publish:     {not publish}", flush=True)


def _run_cycle_stage(
    *,
    launcher: _LocalLauncher,
    dataset_id: str,
    cycle: str,
    run_id: str,
    command_name: str,
) -> int:
    return run_or_print(
        local_container_cmd(
            local_image=launcher.local_image,
            artifacts_dir=launcher.artifacts_dir,
            cache_dir=None,
            env=_cycle_container_env(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
            command=_cycle_command(
                command_name,
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
            ),
        ),
        dry_run=launcher.dry_run,
    )


def _cycle_container_env(*, dataset_id: str, cycle: str, run_id: str) -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "file:///artifacts",
        "DATASET_ID": dataset_id,
        "CYCLE": cycle,
        "RUN_ID": run_id,
    }


def _cycle_command(
    command_name: str,
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> list[str]:
    return [
        command_name,
        "--dataset-id",
        dataset_id,
        "--cycle",
        cycle,
        "--run-id",
        run_id,
    ]


def _cycle_result(
    dataset_id: str,
    cycle: str,
    run_id: str,
    *,
    ok: bool = False,
    workers_started: int,
    workers_skipped: int,
    failures: int = 0,
) -> LocalCycleRunResult:
    return LocalCycleRunResult(
        ok=ok,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        workers_started=workers_started,
        workers_skipped=workers_skipped,
        failures=failures,
    )
