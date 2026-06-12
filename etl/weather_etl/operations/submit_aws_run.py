"""AWS Batch run executor."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..sources.registry import aws_batch_source_uri_overrides
from ..state.runs.ids import generate_run_id, parse_run_id
from ..workers.backends.aws_batch import batch_worker_job_name, launch_aws_batch_plan_workers
from ..workers.claims.dynamo import DynamoFrameClaimStore
from .plan_run import plan_run


@dataclass(frozen=True)
class AwsRunSubmissionResult:
    """AWS Batch submission summary for one run."""

    ok: bool
    dataset_id: str
    cycle: str
    run_id: str
    workers_started: int
    workers_skipped: int
    failures: int = 0


def submit_aws_batch_run(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    selected_artifacts: Iterable[str] | None,
    dry_run: bool,
    batch: Any,
    ddb: Any,
    frame_claim_table: str,
    queue: str,
    job_definition: str,
    source_bucket: str,
    job_name_prefix: str,
    submit_delay_seconds: float,
    now: datetime | None = None,
) -> AwsRunSubmissionResult:
    """Submit one run plan to AWS Batch with frame claims."""

    parse_cycle(cycle)
    effective_now = now or datetime.now(timezone.utc)
    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=frame_claim_table)

    resolved_run_id = parse_run_id(run_id) if run_id else generate_run_id(now=effective_now)
    if dry_run:
        print("Run snapshot", flush=True)
        try:
            snapshot = env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=resolved_run_id)
            print(f"  run_id={snapshot.run_id}", flush=True)
            print(f"  product_config_digest={snapshot.product_config_digest}", flush=True)
            print(f"  pipeline_uri={snapshot.pipeline_uri}", flush=True)
            print(f"  catalog_uri={snapshot.catalog_uri}", flush=True)
        except FileNotFoundError:
            snapshot = None
            print("  dry-run init-run", flush=True)
    else:
        snapshot = env.ensure_run_snapshot(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
        )
        print("Run snapshot", flush=True)
        print(f"  run_id={snapshot.run_id}", flush=True)
        print(f"  product_config_digest={snapshot.product_config_digest}", flush=True)
        print(f"  pipeline_uri={snapshot.pipeline_uri}", flush=True)
        print(f"  catalog_uri={snapshot.catalog_uri}", flush=True)

    source_dataset = snapshot.dataset(dataset_id) if snapshot is not None else env.load_product_config().dataset(dataset_id)
    source_frames = tuple(source_dataset.workload.frames) if selected_frames is None else tuple(selected_frames)
    source_uris = aws_batch_source_uri_overrides(
        dataset=source_dataset,
        cycle=cycle,
        frames=source_frames,
        source_bucket=source_bucket,
    )
    plan = plan_run(
        env=env,
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
    )
    workers = tuple(plan.workers)
    frame_states = tuple(plan.frame_states)
    print("Run plan", flush=True)
    print(f"  dataset_id={dataset_id}", flush=True)
    print(f"  cycle={cycle}", flush=True)
    print(f"  run_id={resolved_run_id}", flush=True)
    print(f"  frames={len(plan.frame_ids)}", flush=True)
    print(f"  workers={len(workers)}", flush=True)
    for state in frame_states:
        print(
            f"frame_id={state.frame_id} state={state.state} "
            f"missing={state.missing_marker_count} errors={len(state.errors)}",
            flush=True,
        )

    workers_skipped = len(frame_states) - len(workers)
    launch_summary = launch_aws_batch_plan_workers(
        plan=plan,
        claim_store=claim_store,
        batch=batch,
        queue=queue,
        job_definition=job_definition,
        job_name_for_worker=lambda worker, _attempt: batch_worker_job_name(
            prefix=job_name_prefix,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
            frame_id=worker.frame_id,
            worker_spec_hash=worker.worker_spec_hash,
        ),
        now=effective_now,
        dry_run=dry_run,
        submit_delay_seconds=submit_delay_seconds,
    )
    for record in launch_summary.records:
        if dry_run:
            print(f"  dry-run job_name={record.job_name or ''}", flush=True)
            continue
        if record.claimed:
            print(f"  skipped claimed frame_id={record.worker.frame_id}", flush=True)
            continue
        print(f"  job_id={record.job_id or ''} frame_id={record.worker.frame_id}", flush=True)
    workers_skipped += launch_summary.workers_claimed

    if dry_run:
        print("Dry run complete.", flush=True)
    else:
        print(f"Submitted {launch_summary.workers_started} Batch jobs.", flush=True)
        print(
            "The scheduled weather-etl-publisher Lambda will validate the run and publish manifests "
            "after all expected success markers exist.",
            flush=True,
        )
    return AwsRunSubmissionResult(
        ok=True,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        workers_started=launch_summary.workers_started,
        workers_skipped=workers_skipped,
    )
