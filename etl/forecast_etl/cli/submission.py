"""Cycle planning and executor command handlers for forecast-etl."""

from __future__ import annotations

import argparse
from pathlib import Path

from ..frame_claims import DynamoFrameClaimStore
from ..workflows.executors import execute_local_docker_cycle, parse_optional_frames, submit_aws_batch_cycle
from ..workflows.planning import parse_frame_selection, plan_cycle
from .arguments import require_dataset_id
from .context import app_context
from .formatting import print_operator_report


def cmd_plan_cycle(args: argparse.Namespace) -> int:
    """Print a read-only provider-neutral cycle plan."""

    result = plan_cycle(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_frame_selection(args.frames),
        selected_artifacts=args.artifacts,
        publish=not args.no_publish,
    )
    print_operator_report(result.plan, as_json=bool(args.json))
    return 0


def cmd_execute_local_cycle(args: argparse.Namespace) -> int:
    """Execute a cycle plan with local Docker workers."""

    if args.procs < 1:
        raise SystemExit("--procs must be at least 1")
    results = execute_local_docker_cycle(
        app_context=app_context(args),
        dataset_id=str(args.dataset_id) if args.dataset_id else None,
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_optional_frames(args.frames),
        selected_artifacts=args.artifacts,
        publish=not args.no_publish,
        procs=int(args.procs),
        dry_run=bool(args.dry_run),
        local_image=str(args.local_image),
        artifacts_dir=Path(args.artifacts_dir),
        cache_dir=Path(args.cache_dir),
        worker_stagger_seconds=float(args.worker_stagger_seconds),
    )
    return 0 if all(result.ok for result in results) else 1


def cmd_submit_aws_cycle(args: argparse.Namespace) -> int:
    """Submit a cycle plan to AWS Batch."""

    import boto3  # type: ignore

    ddb = boto3.client("dynamodb")
    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=str(args.frame_claim_table))
    result = submit_aws_batch_cycle(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_optional_frames(args.frames),
        selected_artifacts=args.artifacts,
        allow_backfill=bool(args.backfill),
        dry_run=bool(args.dry_run),
        batch=boto3.client("batch"),
        claim_store=claim_store,
        queue=str(args.job_queue),
        job_definition=str(args.job_definition),
        source_bucket=str(args.source_bucket),
        job_name_prefix=str(args.job_name_prefix),
        submit_delay_seconds=float(args.submit_delay_seconds),
    )
    return 0 if result.ok else 1

