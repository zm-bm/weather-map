"""Cycle plan executors for local Docker and AWS Batch."""

from __future__ import annotations

import os
import shlex
import subprocess
import time
from concurrent.futures import FIRST_COMPLETED, Future, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

from ..cycles import parse_cycle
from ..frame_claims import FrameClaimStore, NullFrameClaimStore
from ..run_ids import generate_run_id, parse_run_id
from .context import ApplicationContext
from .cycle import init_run
from .planning import parse_frame_selection, plan_cycle


@dataclass(frozen=True)
class ExecutorResult:
    """Submission/execution summary."""

    ok: bool
    dataset_id: str
    cycle: str
    run_id: str
    submitted: int
    skipped: int
    failed: int = 0


def execute_local_docker_cycle(
    *,
    app_context: ApplicationContext,
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
) -> list[ExecutorResult]:
    """Execute one cycle locally using the production worker image."""

    parse_cycle(cycle)
    resolved_run_id = parse_run_id(run_id) if run_id else generate_run_id()
    cfg = app_context.load_pipeline_config()
    dataset_ids = (dataset_id,) if dataset_id else tuple(cfg.datasets)
    results: list[ExecutorResult] = []
    for current_dataset_id in dataset_ids:
        cfg.dataset(current_dataset_id)
        results.append(
            _execute_local_dataset_cycle(
                app_context=app_context,
                dataset_id=current_dataset_id,
                cycle=cycle,
                run_id=resolved_run_id,
                selected_frames=selected_frames,
                selected_artifacts=selected_artifacts,
                publish=publish,
                procs=procs,
                dry_run=dry_run,
                local_image=local_image,
                artifacts_dir=artifacts_dir,
                cache_dir=cache_dir,
                worker_stagger_seconds=worker_stagger_seconds,
            )
        )
    return results


def submit_aws_batch_cycle(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    allow_backfill: bool,
    dry_run: bool,
    batch: Any,
    claim_store: FrameClaimStore,
    queue: str,
    job_definition: str,
    source_bucket: str,
    job_name_prefix: str,
    submit_delay_seconds: float,
    now: datetime | None = None,
) -> ExecutorResult:
    """Submit one cycle plan to AWS Batch with frame claims."""

    from .cycle import check_backfill

    parse_cycle(cycle)
    effective_now = now or datetime.now(timezone.utc)
    backfill = check_backfill(
        app_context=app_context,
        dataset_id=dataset_id,
        cycle=cycle,
        allow_backfill=allow_backfill,
    )
    if not backfill.ok:
        for key, value in backfill.key_values():
            print(f"{key}={value}", flush=True)
        raise SystemExit(2)

    resolved_run_id = parse_run_id(run_id) if run_id else generate_run_id(now=effective_now)
    print("Backfill safety", flush=True)
    for key, value in backfill.key_values():
        print(f"  {key}={value}", flush=True)

    if dry_run:
        print("Run snapshot", flush=True)
        try:
            snapshot = app_context.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id)
            print(f"  run_id={snapshot.run_id}", flush=True)
            print(f"  config_digest={snapshot.config_digest}", flush=True)
            print(f"  pipeline_config_uri={snapshot.pipeline_config_uri}", flush=True)
            print(f"  forecast_catalog_uri={snapshot.forecast_catalog_uri}", flush=True)
        except FileNotFoundError:
            snapshot = None
            print("  dry-run init-run", flush=True)
    else:
        snapshot_result = init_run(
            app_context=app_context,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
        )
        snapshot = snapshot_result.snapshot
        print("Run snapshot", flush=True)
        print(f"  run_id={snapshot_result.run_id}", flush=True)
        print(f"  config_digest={snapshot_result.config_digest}", flush=True)
        print(f"  pipeline_config_uri={snapshot_result.pipeline_config_uri}", flush=True)
        print(f"  forecast_catalog_uri={snapshot_result.forecast_catalog_uri}", flush=True)

    if selected_frames is None:
        frame_source_config = snapshot.loaded_config.config if snapshot is not None else app_context.load_pipeline_config()
        source_frames = tuple(frame_source_config.dataset(dataset_id).workload.frames)
    else:
        source_frames = tuple(selected_frames)
    source_uris = _source_uris_for_dataset(
        dataset_id=dataset_id,
        cycle=cycle,
        frames=source_frames,
        source_bucket=source_bucket,
    )
    plan = plan_cycle(
        app_context=app_context,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        selected_frames=selected_frames,
        selected_artifacts=selected_artifacts,
        publish=True,
        claim_store=claim_store,
        source_uris_by_frame=source_uris,
        now=effective_now,
        loaded_snapshot=snapshot,
    ).plan
    workers = list(plan["workers"])
    frame_states = list(plan["frame_states"])
    print("Cycle plan", flush=True)
    print(f"  dataset_id={dataset_id}", flush=True)
    print(f"  cycle={cycle}", flush=True)
    print(f"  run_id={resolved_run_id}", flush=True)
    print(f"  frames={len(plan['frame_ids'])}", flush=True)
    print(f"  workers={len(workers)}", flush=True)
    for state in frame_states:
        print(
            f"frame_id={state['frame_id']} state={state['state']} "
            f"missing={state['missing_marker_count']} errors={len(state['errors'])}",
            flush=True,
        )

    submitted = 0
    skipped = len(frame_states) - len(workers)
    for worker in workers:
        frame_id = str(worker["frame_id"])
        source_uri = str(worker["env"].get("GRIB_SOURCE_URI", "")) or None
        job_name = _job_name(
            prefix=job_name_prefix,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
            frame_id=frame_id,
            worker_spec_hash=str(worker["worker_spec_hash"]),
        )
        if dry_run:
            print(f"  dry-run job_name={job_name}", flush=True)
            continue
        claim = claim_store.acquire(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
            frame_id=frame_id,
            artifact_ids=tuple(plan["artifact_ids"]),
            worker_spec_hash=str(worker["worker_spec_hash"]),
            source_uri=source_uri,
            now=effective_now,
        )
        if not claim.acquired:
            print(f"  skipped claimed frame_id={frame_id}", flush=True)
            skipped += 1
            continue
        response = batch.submit_job(
            jobName=job_name,
            jobQueue=queue,
            jobDefinition=job_definition,
            containerOverrides={"environment": _batch_env(worker["env"])},
        )
        job_id = str(response.get("jobId", ""))
        claim_store.record_submission(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
            frame_id=frame_id,
            job_id=job_id,
            now=effective_now,
        )
        submitted += 1
        print(f"  job_id={job_id} frame_id={frame_id}", flush=True)
        if submit_delay_seconds:
            time.sleep(submit_delay_seconds)

    if dry_run:
        print("Dry run complete.", flush=True)
    else:
        print(f"Submitted {submitted} Batch jobs.", flush=True)
        print(
            "The scheduled weather-etl-publisher Lambda will validate the run and publish manifests "
            "after all expected success markers exist.",
            flush=True,
        )
    return ExecutorResult(
        ok=True,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        submitted=submitted,
        skipped=skipped,
    )


def _execute_local_dataset_cycle(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
    run_id: str,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    publish: bool,
    procs: int,
    dry_run: bool,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path,
    worker_stagger_seconds: float,
) -> ExecutorResult:
    print(f"Initializing local run snapshot: dataset_id={dataset_id} cycle={cycle}", flush=True)
    init_cmd = _local_container_cmd(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=None,
        env={
            "ARTIFACT_ROOT_URI": "file:///artifacts",
            "DATASET_ID": dataset_id,
            "CYCLE": cycle,
            "RUN_ID": run_id,
        },
        command=[
            "init-run",
            "--dataset-id",
            dataset_id,
            "--cycle",
            cycle,
            "--run-id",
            run_id,
            "--pipeline-config-overlay-uri",
            "file:///app/config/pipeline/local.json",
        ],
    )
    if dry_run:
        _run_or_print(init_cmd, dry_run=True)
        print(
            "  pipeline_config_uri: "
            + _container_uri(
                app_context.artifact_repo.paths.run_pipeline_config_uri(
                    dataset_id=dataset_id,
                    cycle=cycle,
                    run_id=run_id,
                ),
                artifacts_dir=artifacts_dir,
            ),
            flush=True,
        )
        print(
            "  forecast_catalog_uri: "
            + _container_uri(
                app_context.artifact_repo.paths.run_forecast_catalog_uri(
                    dataset_id=dataset_id,
                    cycle=cycle,
                    run_id=run_id,
                ),
                artifacts_dir=artifacts_dir,
            ),
            flush=True,
        )
    else:
        if _run_command(init_cmd) != 0:
            return ExecutorResult(False, dataset_id, cycle, run_id, submitted=0, skipped=0, failed=1)

    plan = plan_cycle(
        app_context=app_context,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        selected_frames=selected_frames,
        selected_artifacts=selected_artifacts,
        publish=publish,
        claim_store=NullFrameClaimStore(),
    ).plan
    workers = list(plan["workers"])
    skipped = len(plan["frame_states"]) - len(workers)
    print("Running local containerized pipeline", flush=True)
    print(f"  dataset_id:     {dataset_id}", flush=True)
    print(f"  cycle:          {cycle}", flush=True)
    print(f"  run_id:         {run_id}", flush=True)
    print(f"  frames: {len(plan['frame_ids'])}", flush=True)
    print(f"  workers: {len(workers)}", flush=True)
    print(f"  skipped: {skipped}", flush=True)
    print(f"  procs:          {procs}", flush=True)
    print(f"  dry_run:        {dry_run}", flush=True)
    print(f"  no_publish:     {not publish}", flush=True)

    failed = _run_local_workers(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=cache_dir,
        workers=workers,
        procs=procs,
        dry_run=dry_run,
        worker_stagger_seconds=worker_stagger_seconds,
    )
    if failed:
        return ExecutorResult(False, dataset_id, cycle, run_id, submitted=0, skipped=skipped, failed=failed)

    validate_cmd = _local_container_cmd(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=None,
        env={
            "ARTIFACT_ROOT_URI": "file:///artifacts",
            "DATASET_ID": dataset_id,
            "CYCLE": cycle,
            "RUN_ID": run_id,
        },
        command=["validate-cycle", "--dataset-id", dataset_id, "--cycle", cycle, "--run-id", run_id],
    )
    print(f"Validating local cycle: dataset_id={dataset_id} cycle={cycle}", flush=True)
    if _run_or_print(validate_cmd, dry_run=dry_run) != 0:
        return ExecutorResult(False, dataset_id, cycle, run_id, submitted=len(workers), skipped=skipped, failed=1)
    if publish:
        publish_cmd = _local_container_cmd(
            local_image=local_image,
            artifacts_dir=artifacts_dir,
            cache_dir=None,
            env={
                "ARTIFACT_ROOT_URI": "file:///artifacts",
                "DATASET_ID": dataset_id,
                "CYCLE": cycle,
                "RUN_ID": run_id,
            },
            command=["publish-cycle", "--dataset-id", dataset_id, "--cycle", cycle, "--run-id", run_id],
        )
        print(f"Publishing local cycle manifest: dataset_id={dataset_id} cycle={cycle}", flush=True)
        if _run_or_print(publish_cmd, dry_run=dry_run) != 0:
            return ExecutorResult(False, dataset_id, cycle, run_id, submitted=len(workers), skipped=skipped, failed=1)
    return ExecutorResult(True, dataset_id, cycle, run_id, submitted=len(workers), skipped=skipped)


def _run_local_workers(
    *,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path,
    workers: list[Mapping[str, Any]],
    procs: int,
    dry_run: bool,
    worker_stagger_seconds: float,
) -> int:
    if dry_run:
        for worker in workers:
            _run_or_print(
                _worker_container_cmd(local_image=local_image, artifacts_dir=artifacts_dir, cache_dir=cache_dir, worker=worker),
                dry_run=True,
            )
        return 0

    failures = 0
    active: set[Future[int]] = set()
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=max(1, procs)) as executor:
        for index, worker in enumerate(workers):
            if index > 0 and worker_stagger_seconds:
                time.sleep(worker_stagger_seconds)
            active.add(
                executor.submit(
                    _run_command,
                    _worker_container_cmd(
                        local_image=local_image,
                        artifacts_dir=artifacts_dir,
                        cache_dir=cache_dir,
                        worker=worker,
                    ),
                )
            )
            if len(active) >= max(1, procs):
                done, active = wait(active, return_when=FIRST_COMPLETED)
                failures += sum(1 for item in done if item.result() != 0)
        while active:
            done, active = wait(active, return_when=FIRST_COMPLETED)
            failures += sum(1 for item in done if item.result() != 0)
    return failures


def _worker_container_cmd(
    *,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path,
    worker: Mapping[str, Any],
) -> list[str]:
    env = {
        str(key): _container_uri(str(value), artifacts_dir=artifacts_dir)
        for key, value in dict(worker["env"]).items()
    }
    return _local_container_cmd(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=cache_dir,
        env=env,
        command=["run-frame", *list(worker["command"][2:])],
    )


def _local_container_cmd(
    *,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path | None,
    env: Mapping[str, str],
    command: list[str],
) -> list[str]:
    cmd = [
        "docker",
        "run",
        "--rm",
        "--network",
        "host",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--volume",
        f"{artifacts_dir.as_posix()}:/artifacts",
    ]
    if cache_dir is not None:
        cmd.extend(["--volume", f"{cache_dir.as_posix()}:/app/etl/cache"])
    merged_env = dict(env)
    for metadata_env in ("ETL_CODE_REVISION", "ETL_IMAGE_IDENTITY"):
        value = os.environ.get(metadata_env)
        if value:
            merged_env.setdefault(metadata_env, value)
    for key, value in merged_env.items():
        cmd.extend(["--env", f"{key}={value}"])
    cmd.extend(["--env", "PYTHONDONTWRITEBYTECODE=1", local_image, *command])
    return cmd


def _run_or_print(cmd: list[str], *, dry_run: bool) -> int:
    if dry_run:
        print("dry-run: " + shlex.join(cmd), flush=True)
        return 0
    return _run_command(cmd)


def _run_command(cmd: list[str]) -> int:
    return subprocess.run(cmd, check=False).returncode


def _container_uri(value: str, *, artifacts_dir: Path) -> str:
    host_prefix = artifacts_dir.as_uri()
    if value == host_prefix:
        return "file:///artifacts"
    if value.startswith(host_prefix + "/"):
        return "file:///artifacts/" + value[len(host_prefix) + 1:]
    return value


def _source_uris_for_dataset(
    *,
    dataset_id: str,
    cycle: str,
    frames: Iterable[str],
    source_bucket: str,
) -> dict[str, str]:
    if dataset_id != "gfs":
        return {}
    cycle_date = cycle[:8]
    cycle_hour = cycle[8:10]
    return {
        frame_id: f"s3://{source_bucket}/gfs.{cycle_date}/{cycle_hour}/atmos/gfs.t{cycle_hour}z.pgrb2.0p25.f{frame_id}"
        for frame_id in frames
    }


def _batch_env(env: Mapping[str, str]) -> list[dict[str, str]]:
    return [{"name": key, "value": value} for key, value in env.items()]


def _job_name(
    *,
    prefix: str,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    worker_spec_hash: str,
) -> str:
    return f"{prefix}-{dataset_id}-{cycle}-{run_id}-{frame_id}-{worker_spec_hash[:8]}"[:128]


def parse_optional_frames(raw: str | None) -> tuple[str, ...] | None:
    return parse_frame_selection(raw)
