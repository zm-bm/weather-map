"""Run local ETL run targets with planned Docker workers."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from ..environment import EtlEnvironment
from ..storage.uris import path_from_file_uri
from ..workers.backends.local_docker import (
    LocalDockerWorkerBackend,
    container_uri,
    local_container_cmd,
    run_or_print,
)
from ..workers.claims.store import NullFrameClaimStore
from ..workers.launch import WorkerLaunchRecord, WorkerLaunchRequest
from ..workers.plan import RunPlan
from .plan_run import plan_run
from .run_layouts import RunTarget, local_run_targets


@dataclass(frozen=True)
class LocalRunResult:
    """Local lifecycle summary for one run target."""

    ok: bool
    dataset_id: str
    cycle: str
    run_id: str
    workers_started: int
    workers_skipped: int
    failures: int = 0


@dataclass(frozen=True)
class _LocalRunContext:
    local_image: str
    artifacts_dir: Path
    cache_dir: Path
    stage_mounts: tuple[tuple[Path, str], ...]
    stage_pipeline_uri: str
    stage_catalog_uri: str
    procs: int
    dry_run: bool
    worker_stagger_seconds: float


@dataclass(frozen=True)
class _PreparedRunTarget:
    index: int
    target: RunTarget
    workers_skipped: int
    worker_requests: tuple[WorkerLaunchRequest, ...]


def run_local(
    *,
    env: EtlEnvironment,
    dataset_id: str | None,
    cycle: str | None,
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
) -> list[LocalRunResult]:
    """Run the local lifecycle using the production worker image."""

    product_config = env.load_product_config()
    stage_mounts, stage_pipeline_uri, stage_catalog_uri = _local_stage_inputs(
        pipeline_uri=env.pipeline_uri,
        catalog_uri=env.catalog_uri,
    )
    context = _LocalRunContext(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=cache_dir,
        stage_mounts=stage_mounts,
        stage_pipeline_uri=stage_pipeline_uri,
        stage_catalog_uri=stage_catalog_uri,
        procs=procs,
        dry_run=dry_run,
        worker_stagger_seconds=worker_stagger_seconds,
    )
    targets = local_run_targets(
        product_config=product_config,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        selected_frames=selected_frames,
        store=env.store,
    )
    results: list[LocalRunResult | None] = [None] * len(targets)
    prepared: list[_PreparedRunTarget] = []
    for index, target in enumerate(targets):
        prepared_target, failed_result = _prepare_run_target(
            env=env,
            index=index,
            target=target,
            selected_artifacts=selected_artifacts,
            publish=publish,
            context=context,
        )
        if failed_result is not None:
            results[index] = failed_result
        if prepared_target is not None:
            prepared.append(prepared_target)

    worker_requests = tuple(
        request
        for prepared_target in prepared
        for request in prepared_target.worker_requests
    )
    if worker_requests:
        backend = LocalDockerWorkerBackend(
            local_image=context.local_image,
            artifacts_dir=context.artifacts_dir,
            cache_dir=context.cache_dir,
            procs=context.procs,
            worker_stagger_seconds=context.worker_stagger_seconds,
        )
        launch_records = backend.launch_many(worker_requests, dry_run=context.dry_run)
    else:
        launch_records = ()
    launched_by_index = _records_by_target_index(prepared=prepared, launch_records=launch_records)

    for prepared_target in prepared:
        records = launched_by_index.get(prepared_target.index, ())
        worker_failures = sum(1 for record in records if record.failed)
        workers_started = sum(1 for record in records if record.started)
        if worker_failures:
            results[prepared_target.index] = _run_result(
                prepared_target.target.dataset_id,
                prepared_target.target.cycle,
                prepared_target.target.run_id,
                workers_started=workers_started,
                workers_skipped=prepared_target.workers_skipped,
                failures=worker_failures,
            )
            continue

        validate_status = _run_target_validate_stage(
            context=context,
            target=prepared_target.target,
        )
        if validate_status != 0:
            results[prepared_target.index] = _run_result(
                prepared_target.target.dataset_id,
                prepared_target.target.cycle,
                prepared_target.target.run_id,
                workers_started=workers_started,
                workers_skipped=prepared_target.workers_skipped,
                failures=1,
            )
            continue

        if publish:
            publish_status = _run_target_publish_stage(
                context=context,
                target=prepared_target.target,
            )
            if publish_status != 0:
                results[prepared_target.index] = _run_result(
                    prepared_target.target.dataset_id,
                    prepared_target.target.cycle,
                    prepared_target.target.run_id,
                    workers_started=workers_started,
                    workers_skipped=prepared_target.workers_skipped,
                    failures=1,
                )
                continue

        results[prepared_target.index] = _run_result(
            prepared_target.target.dataset_id,
            prepared_target.target.cycle,
            prepared_target.target.run_id,
            ok=True,
            workers_started=workers_started,
            workers_skipped=prepared_target.workers_skipped,
        )

    if any(result is None for result in results):
        raise RuntimeError("local target execution did not produce a result for every target")
    return [result for result in results if result is not None]


def _prepare_run_target(
    *,
    env: EtlEnvironment,
    index: int,
    target: RunTarget,
    selected_artifacts: Iterable[str] | None,
    publish: bool,
    context: _LocalRunContext,
) -> tuple[_PreparedRunTarget | None, LocalRunResult | None]:
    print(f"Initializing local run snapshot: dataset_id={target.dataset_id} cycle={target.cycle}", flush=True)
    init_status = _run_local_stage(
        context=context,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        command_name="init-run",
        selected_frames=target.snapshot_frames,
    )
    if context.dry_run:
        _print_dry_run_snapshot_uris(
            env=env,
            context=context,
            dataset_id=target.dataset_id,
            cycle=target.cycle,
            run_id=target.run_id,
        )
    elif init_status != 0:
        return None, _run_result(
            target.dataset_id,
            target.cycle,
            target.run_id,
            workers_started=0,
            workers_skipped=0,
            failures=1,
        )

    plan = plan_run(
        env=env,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        selected_frames=target.plan_frames,
        selected_artifacts=selected_artifacts,
        publish=publish,
        claim_store=NullFrameClaimStore(),
    )
    workers_skipped = len(plan.frame_states) - len(plan.workers)
    _print_plan_summary(plan=plan, workers_skipped=workers_skipped, context=context, publish=publish)
    return (
        _PreparedRunTarget(
            index=index,
            target=target,
            workers_skipped=workers_skipped,
            worker_requests=tuple(
                WorkerLaunchRequest(worker=worker, source_uri=worker.source_uri)
                for worker in plan.workers
            ),
        ),
        None,
    )


def _records_by_target_index(
    *,
    prepared: list[_PreparedRunTarget],
    launch_records: tuple[WorkerLaunchRecord, ...],
) -> dict[int, tuple[WorkerLaunchRecord, ...]]:
    expected_count = sum(len(prepared_target.worker_requests) for prepared_target in prepared)
    if expected_count != len(launch_records):
        raise RuntimeError("local worker launch count did not match prepared worker requests")
    launched_by_index: dict[int, tuple[WorkerLaunchRecord, ...]] = {}
    offset = 0
    for prepared_target in prepared:
        count = len(prepared_target.worker_requests)
        launched_by_index[prepared_target.index] = launch_records[offset : offset + count]
        offset += count
    return launched_by_index


def _run_target_validate_stage(*, context: _LocalRunContext, target: RunTarget) -> int:
    print(f"Validating local run: dataset_id={target.dataset_id} cycle={target.cycle}", flush=True)
    return _run_local_stage(
        context=context,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        command_name="validate-run",
        selected_frames=None,
    )


def _run_target_publish_stage(*, context: _LocalRunContext, target: RunTarget) -> int:
    print(f"Publishing local run: dataset_id={target.dataset_id} cycle={target.cycle}", flush=True)
    return _run_local_stage(
        context=context,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        command_name="publish-run",
        selected_frames=None,
    )


def _print_dry_run_snapshot_uris(
    *,
    env: EtlEnvironment,
    context: _LocalRunContext,
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
            artifacts_dir=context.artifacts_dir,
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
            artifacts_dir=context.artifacts_dir,
        ),
        flush=True,
    )


def _print_plan_summary(
    *,
    plan: RunPlan,
    workers_skipped: int,
    context: _LocalRunContext,
    publish: bool,
) -> None:
    print("Running local containerized pipeline", flush=True)
    print(f"  dataset_id:     {plan.dataset_id}", flush=True)
    print(f"  cycle:          {plan.cycle}", flush=True)
    print(f"  run_id:         {plan.run_id}", flush=True)
    print(f"  frames: {len(plan.frame_ids)}", flush=True)
    print(f"  workers: {len(plan.workers)}", flush=True)
    print(f"  skipped: {workers_skipped}", flush=True)
    print(f"  procs:          {context.procs}", flush=True)
    print(f"  dry_run:        {context.dry_run}", flush=True)
    print(f"  no_publish:     {not publish}", flush=True)


def _run_local_stage(
    *,
    context: _LocalRunContext,
    dataset_id: str,
    cycle: str,
    run_id: str,
    command_name: str,
    selected_frames: Iterable[str] | None,
) -> int:
    return run_or_print(
        local_container_cmd(
            local_image=context.local_image,
            artifacts_dir=context.artifacts_dir,
            cache_dir=None,
            extra_mounts=dict(context.stage_mounts),
            env=_run_container_env(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
                pipeline_uri=context.stage_pipeline_uri,
                catalog_uri=context.stage_catalog_uri,
            ),
            command=_run_command(
                command_name,
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
                selected_frames=selected_frames,
            ),
        ),
        dry_run=context.dry_run,
    )


def _run_container_env(
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
    pipeline_uri: str,
    catalog_uri: str,
) -> dict[str, str]:
    return {
        "ARTIFACT_ROOT_URI": "file:///artifacts",
        "PIPELINE_URI": pipeline_uri,
        "CATALOG_URI": catalog_uri,
        "DATASET_ID": dataset_id,
        "CYCLE": cycle,
        "RUN_ID": run_id,
    }


def _run_command(
    command_name: str,
    *,
    dataset_id: str,
    cycle: str,
    run_id: str,
    selected_frames: Iterable[str] | None,
) -> list[str]:
    command = [
        command_name,
        "--dataset-id",
        dataset_id,
        "--cycle",
        cycle,
        "--run-id",
        run_id,
    ]
    if selected_frames is not None:
        command.extend(["--frames", " ".join(str(frame_id) for frame_id in selected_frames)])
    return command


def _run_result(
    dataset_id: str,
    cycle: str,
    run_id: str,
    *,
    ok: bool = False,
    workers_started: int,
    workers_skipped: int,
    failures: int = 0,
) -> LocalRunResult:
    return LocalRunResult(
        ok=ok,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        workers_started=workers_started,
        workers_skipped=workers_skipped,
        failures=failures,
    )


def _local_stage_inputs(
    *,
    pipeline_uri: str,
    catalog_uri: str,
) -> tuple[tuple[tuple[Path, str], ...], str, str]:
    mounts_by_parent: dict[Path, str] = {}
    mapped_uris: list[str] = []
    for uri in (pipeline_uri, catalog_uri):
        if not uri.startswith("file://"):
            mapped_uris.append(uri)
            continue
        source_path = path_from_file_uri(uri).resolve()
        parent = source_path.parent
        container_root = mounts_by_parent.setdefault(parent, f"/config/{len(mounts_by_parent) + 1}")
        mapped_uris.append(f"file://{container_root}/{source_path.name}")
    return tuple(mounts_by_parent.items()), mapped_uris[0], mapped_uris[1]
