"""CLI command handlers for weather-etl."""

from __future__ import annotations

import argparse

from ...operations.run_frame import run_frame
from ...operations.submit_aws_run import submit_aws_batch_run
from .arguments import optional_str, parse_frame_selection, require_dataset_id, require_str
from .context import build_environment


def cmd_run_frame(args: argparse.Namespace) -> int:
    """Run one debug/repair frame without publishing."""

    app = build_environment(args)
    dataset_id = require_dataset_id(args)
    cycle = require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle")
    run_id = require_str(getattr(args, "run_id", None), env_name="RUN_ID", cli_flag="--run-id")
    frame_id = require_str(args.frame_id, env_name="FRAME_ID", cli_flag="--frame-id")
    source_uri = optional_str(args.source_uri, env_name="GRIB_SOURCE_URI")
    run_frame(
        env=app,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        source_uri=source_uri,
        selected_artifacts=args.artifacts,
    )
    return 0


def cmd_submit_aws_run(args: argparse.Namespace) -> int:
    """Submit AWS Batch frame workers for one run."""

    import boto3  # type: ignore

    result = submit_aws_batch_run(
        env=build_environment(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_frame_selection(args.frames),
        selected_artifacts=args.artifacts,
        dry_run=bool(args.dry_run),
        batch=boto3.client("batch"),
        ddb=boto3.client("dynamodb"),
        frame_claim_table=str(args.frame_claim_table),
        queue=str(args.job_queue),
        job_definition=str(args.job_definition),
        source_bucket=str(args.source_bucket),
        job_name_prefix=str(args.job_name_prefix),
        submit_delay_seconds=float(args.submit_delay_seconds),
    )
    return 0 if result.ok else 1
