"""Lifecycle command handlers for forecast-etl."""

from __future__ import annotations

import argparse
import os

from ..workflows import cycle as cycle_workflow
from .arguments import require_dataset_id, require_str
from .context import app_context
from .formatting import print_not_ready


def cmd_run_frame(args: argparse.Namespace) -> int:
    """Run one frame without publishing."""

    source_uri = (
        args.source_uri
        if isinstance(args.source_uri, str) and args.source_uri.strip()
        else os.environ.get("GRIB_SOURCE_URI")
    )
    source_uri = source_uri.strip() if isinstance(source_uri, str) and source_uri.strip() else None

    cycle_workflow.process_frame(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle"),
        run_id=require_str(getattr(args, "run_id", None), env_name="RUN_ID", cli_flag="--run-id"),
        frame_id=require_str(args.frame_id, env_name="FRAME_ID", cli_flag="--frame-id"),
        source_uri=source_uri,
        artifact_ids=args.artifacts,
    )
    return 0


def cmd_check_backfill(args: argparse.Namespace) -> int:
    """Guard against accidental older-than-latest submits."""

    result = cycle_workflow.check_backfill(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        allow_backfill=bool(args.backfill),
    )
    for key, value in result.key_values():
        print(f"{key}={value}")
    return 0 if result.ok else 2


def cmd_init_run(args: argparse.Namespace) -> int:
    """Create or verify immutable run config/catalog snapshots."""

    result = cycle_workflow.init_run(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    print(f"run_id={result.run_id}")
    print(f"config_digest={result.config_digest}")
    print(f"pipeline_config_uri={result.pipeline_config_uri}")
    print(f"forecast_catalog_uri={result.forecast_catalog_uri}")
    return 0


def cmd_run_cycle(args: argparse.Namespace) -> int:
    """Fan out dataset frame workers locally, and publish once by default."""

    cycle_workflow.process_cycle(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        artifact_ids=args.artifacts,
        procs=args.procs,
        publish=not args.no_publish,
    )
    return 0


def cmd_publish_cycle(args: argparse.Namespace) -> int:
    """Publish one processed dataset cycle."""

    dataset_id = require_dataset_id(args)
    cycle = str(args.cycle)
    result = cycle_workflow.publish_cycle(
        app_context=app_context(args),
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready and result.publish_result is None:
        print_not_ready(label="Publish", dataset_id=dataset_id, cycle=cycle, result=result)
        return 2
    return 0 if result.ready else 2


def cmd_validate_cycle(args: argparse.Namespace) -> int:
    """Validate one processed dataset cycle."""

    dataset_id = require_dataset_id(args)
    cycle = str(args.cycle)
    result = cycle_workflow.validate_cycle(
        app_context=app_context(args),
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready:
        print_not_ready(label="Validation", dataset_id=dataset_id, cycle=cycle, result=result)
        return 2
    return 0 if result.passed else 2

