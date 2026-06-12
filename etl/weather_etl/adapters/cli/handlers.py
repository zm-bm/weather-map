"""CLI command handlers for weather-etl."""

from __future__ import annotations

import argparse
from pathlib import Path

from ...operations.init_run import init_run
from ...operations.inspect_runs import inspect_runs, inspect_status
from ...operations.plan_run import plan_run
from ...operations.publish_run import publish_run
from ...operations.run_frame import run_frame
from ...operations.run_local import run_local
from ...operations.submit_aws_run import submit_aws_batch_run
from ...operations.validate_run import validate_run
from .arguments import optional_str, parse_frame_selection, require_dataset_id, require_str
from .context import build_environment
from .formatting import print_not_ready, print_operator_report


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


def cmd_init_run(args: argparse.Namespace) -> int:
    """Create or verify immutable run config/catalog snapshots."""

    snapshot = init_run(
        env=build_environment(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_frame_selection(args.frames),
    )
    print(f"run_id={snapshot.run_id}")
    print(f"product_config_digest={snapshot.product_config_digest}")
    print(f"pipeline_uri={snapshot.pipeline_uri}")
    print(f"catalog_uri={snapshot.catalog_uri}")
    return 0


def cmd_plan_run(args: argparse.Namespace) -> int:
    """Print a read-only run worker plan."""

    plan = plan_run(
        env=build_environment(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_frame_selection(args.frames),
        selected_artifacts=args.artifacts,
        publish=not args.no_publish,
    )
    print_operator_report(plan.to_operator_dict(), as_json=bool(args.json))
    return 0


def cmd_run_local(args: argparse.Namespace) -> int:
    """Run the normal local full lifecycle for selected run targets."""

    if args.procs < 1:
        raise SystemExit("--procs must be at least 1")
    results = run_local(
        env=build_environment(args),
        dataset_id=str(args.dataset_id) if args.dataset_id else None,
        cycle=str(args.cycle) if args.cycle else None,
        run_id=args.run_id,
        selected_frames=parse_frame_selection(args.frames),
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


def cmd_publish_run(args: argparse.Namespace) -> int:
    """Publish one processed run as a debug/repair stage."""

    dataset_id = require_dataset_id(args)
    cycle = str(args.cycle)
    result = publish_run(
        env=build_environment(args),
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready and result.run_publish_result is None:
        print_not_ready(label="Publish", dataset_id=dataset_id, cycle=cycle, result=result)
        return 2
    return 0 if result.ready else 2


def cmd_validate_run(args: argparse.Namespace) -> int:
    """Validate one processed run as a debug/repair stage."""

    dataset_id = require_dataset_id(args)
    cycle = str(args.cycle)
    result = validate_run(
        env=build_environment(args),
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready:
        print_not_ready(label="Validation", dataset_id=dataset_id, cycle=cycle, result=result)
        return 2
    return 0 if result.passed else 2


def cmd_runs(args: argparse.Namespace) -> int:
    """Inspect known runs for one dataset cycle."""

    report = inspect_runs(
        env=build_environment(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
    )
    print_operator_report(report, as_json=bool(args.json))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Inspect one run for one dataset cycle."""

    report = inspect_status(
        env=build_environment(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    print_operator_report(report, as_json=bool(args.json))
    return 0


def cmd_list_frames(args: argparse.Namespace) -> int:
    """Print one configured frame id per line."""

    cfg = build_environment(args).load_product_config().pipeline_config
    dataset = cfg.dataset(require_dataset_id(args))
    for frame_id in dataset.workload.frames:
        print(frame_id)
    return 0


def cmd_list_datasets(args: argparse.Namespace) -> int:
    """Print one configured dataset id per line."""

    cfg = build_environment(args).load_product_config().pipeline_config
    for dataset_id in cfg.datasets:
        print(dataset_id)
    return 0


def cmd_smoke(args: argparse.Namespace) -> int:
    del args
    print("hello world")
    return 0
