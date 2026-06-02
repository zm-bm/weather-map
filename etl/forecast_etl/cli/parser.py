"""forecast_etl CLI.

Subcommands:
- check-backfill: guard against accidental older-than-latest submits
- init-run: create or verify immutable run config/catalog snapshots
- run-frame: run all configured artifacts for one (cycle, frame_id)
- run-cycle: process all configured frames for one dataset, and publish once
- plan-cycle: print a read-only cycle submission plan
- publish-cycle: publish manifests for one processed dataset cycle
- validate-cycle: validate one processed dataset cycle before publication
- runs: inspect known run attempts for one dataset cycle
- status: inspect one run attempt for one dataset cycle
- pointers: inspect public manifest pointers for one dataset
- cleanup-runs: report run cleanup candidates without deleting objects
- list-datasets: print configured dataset ids
- list-frames: print configured frame ids for one dataset
- smoke: trivial health/debug command for Batch smoke tests
"""

from __future__ import annotations

import argparse

from .arguments import add_artifact_filter_arg, config_parser, runtime_parser
from .discovery import cmd_list_datasets, cmd_list_frames, cmd_smoke
from .inspection import cmd_cleanup_runs, cmd_pointers, cmd_runs, cmd_status
from .lifecycle import (
    cmd_check_backfill,
    cmd_init_run,
    cmd_publish_cycle,
    cmd_run_cycle,
    cmd_run_frame,
    cmd_validate_cycle,
)
from .submission import cmd_execute_local_cycle, cmd_plan_cycle, cmd_submit_aws_cycle


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the `forecast-etl` command-line parser."""

    ap = argparse.ArgumentParser(description="forecast_etl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    runtime = runtime_parser()
    config = config_parser()

    ap_init_run = sub.add_parser(
        "init-run",
        help="Create or verify immutable config/catalog snapshots for one run",
        parents=[runtime],
    )
    ap_init_run.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_init_run.add_argument("--run-id", required=True, help="Run id")
    ap_init_run.set_defaults(_handler=cmd_init_run)

    ap_check_backfill = sub.add_parser(
        "check-backfill",
        help="Check whether a requested cycle is older than the current latest manifest",
        parents=[runtime],
    )
    ap_check_backfill.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_check_backfill.add_argument(
        "--backfill",
        action="store_true",
        help="Allow submitting a cycle older than the current latest manifest",
    )
    ap_check_backfill.set_defaults(_handler=cmd_check_backfill)

    ap_run_frame = sub.add_parser(
        "run-frame",
        help="Run one (cycle, frame_id) across all configured artifacts",
        parents=[runtime],
    )
    ap_run_frame.add_argument("--cycle", help="Cycle YYYYMMDDHH (falls back to $CYCLE)")
    ap_run_frame.add_argument("--run-id", help="Run id (falls back to $RUN_ID)")
    ap_run_frame.add_argument("--frame-id", dest="frame_id", help="Frame id (falls back to $FRAME_ID)")
    ap_run_frame.add_argument(
        "--source-uri",
        help="Input source URI (file://..., s3://..., http(s)://); falls back to $GRIB_SOURCE_URI",
    )
    add_artifact_filter_arg(ap_run_frame)
    ap_run_frame.set_defaults(_handler=cmd_run_frame)

    ap_run_cycle = sub.add_parser(
        "run-cycle",
        help="Process all configured frames for one dataset, and publish once",
        parents=[runtime],
    )
    ap_run_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_run_cycle.add_argument(
        "--run-id",
        help="Run id for this local cycle attempt (default: generated once per run-cycle invocation)",
    )
    ap_run_cycle.add_argument(
        "--procs",
        type=int,
        default=None,
        help="Process count (default: 4, or 1 for ICON; use 0 for cpu count)",
    )
    ap_run_cycle.add_argument(
        "--no-publish",
        action="store_true",
        help="Skip publish after processing all configured frames",
    )
    add_artifact_filter_arg(ap_run_cycle)
    ap_run_cycle.set_defaults(_handler=cmd_run_cycle)

    ap_plan_cycle = sub.add_parser(
        "plan-cycle",
        help="Print a read-only cycle submission plan",
        parents=[runtime],
    )
    ap_plan_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_plan_cycle.add_argument(
        "--run-id",
        help="Run id for this cycle attempt (default: generated for this plan)",
    )
    ap_plan_cycle.add_argument(
        "--frames",
        help='Configured frame subset, e.g. "000 003" or "000,003"',
    )
    ap_plan_cycle.add_argument(
        "--no-publish",
        action="store_true",
        help="Omit the publish step from the plan",
    )
    ap_plan_cycle.add_argument("--json", action="store_true", help="Emit structured JSON")
    add_artifact_filter_arg(ap_plan_cycle)
    ap_plan_cycle.set_defaults(_handler=cmd_plan_cycle)

    ap_execute_local = sub.add_parser(
        "execute-local-cycle",
        help="Execute a cycle plan with local Docker workers",
        parents=[config],
    )
    ap_execute_local.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_execute_local.add_argument("--run-id", help="Run id for this cycle attempt (default: generated)")
    ap_execute_local.add_argument("--dataset-id", help="Dataset id (default: all configured datasets)")
    ap_execute_local.add_argument("--frames", help='Configured frame subset, e.g. "000 003" or "000,003"')
    ap_execute_local.add_argument("--artifact-root-uri", required=True, help="Host artifact root URI")
    ap_execute_local.add_argument("--artifacts-dir", required=True, help="Host artifacts directory mounted at /artifacts")
    ap_execute_local.add_argument("--cache-dir", required=True, help="Host cache directory mounted in the worker")
    ap_execute_local.add_argument("--local-image", required=True, help="Local worker image tag")
    ap_execute_local.add_argument("--procs", type=int, default=1, help="Maximum concurrent local worker containers")
    ap_execute_local.add_argument("--worker-stagger-seconds", type=float, default=0.0)
    ap_execute_local.add_argument("--dry-run", action="store_true")
    ap_execute_local.add_argument("--no-publish", action="store_true")
    add_artifact_filter_arg(ap_execute_local)
    ap_execute_local.set_defaults(_handler=cmd_execute_local_cycle)

    ap_submit_aws = sub.add_parser(
        "submit-aws-cycle",
        help="Submit a cycle plan to AWS Batch",
        parents=[runtime],
    )
    ap_submit_aws.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_submit_aws.add_argument("--run-id", help="Run id for this cycle attempt (default: generated)")
    ap_submit_aws.add_argument("--frames", help='Configured frame subset, e.g. "000 003" or "000,003"')
    ap_submit_aws.add_argument("--job-queue", required=True)
    ap_submit_aws.add_argument("--job-definition", required=True)
    ap_submit_aws.add_argument("--frame-claim-table", required=True)
    ap_submit_aws.add_argument("--source-bucket", default="noaa-gfs-bdp-pds")
    ap_submit_aws.add_argument("--job-name-prefix", default="weather-etl-manual")
    ap_submit_aws.add_argument("--submit-delay-seconds", type=float, default=0.0)
    ap_submit_aws.add_argument("--backfill", action="store_true")
    ap_submit_aws.add_argument("--dry-run", action="store_true")
    add_artifact_filter_arg(ap_submit_aws)
    ap_submit_aws.set_defaults(_handler=cmd_submit_aws_cycle)

    ap_publish_cycle = sub.add_parser(
        "publish-cycle",
        help="Publish manifests for one processed dataset cycle",
        parents=[runtime],
    )
    ap_publish_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_publish_cycle.add_argument(
        "--run-id",
        help="Optional run id to require while publishing; otherwise derived from success markers",
    )
    ap_publish_cycle.set_defaults(_handler=cmd_publish_cycle)

    ap_validate_cycle = sub.add_parser(
        "validate-cycle",
        help="Validate a processed forecast cycle before publication",
        parents=[runtime],
    )
    ap_validate_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_validate_cycle.add_argument(
        "--run-id",
        help="Optional run id to require while validating; otherwise derived from run objects",
    )
    ap_validate_cycle.set_defaults(_handler=cmd_validate_cycle)

    ap_runs = sub.add_parser(
        "runs",
        help="Inspect known run attempts for one dataset cycle",
        parents=[runtime],
    )
    ap_runs.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_runs.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_runs.set_defaults(_handler=cmd_runs)

    ap_status = sub.add_parser(
        "status",
        help="Inspect one run attempt for one dataset cycle",
        parents=[runtime],
    )
    ap_status.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_status.add_argument("--run-id", help="Optional run id to inspect; defaults to the only/newest run")
    ap_status.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_status.set_defaults(_handler=cmd_status)

    ap_pointers = sub.add_parser(
        "pointers",
        help="Inspect public manifest pointers for one dataset",
        parents=[runtime],
    )
    ap_pointers.add_argument("--cycle", help="Optional cycle YYYYMMDDHH for current pointer inspection")
    ap_pointers.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_pointers.set_defaults(_handler=cmd_pointers)

    ap_cleanup_runs = sub.add_parser(
        "cleanup-runs",
        help="Report or delete run cleanup candidates",
        parents=[runtime],
    )
    ap_cleanup_runs.add_argument("--cycle", help="Optional cycle YYYYMMDDHH to restrict cleanup inspection")
    ap_cleanup_runs.add_argument(
        "--delete",
        action="store_true",
        help="Delete objects for cleanup candidates; requires --yes",
    )
    ap_cleanup_runs.add_argument(
        "--yes",
        action="store_true",
        help="Confirm deletion when --delete is set",
    )
    ap_cleanup_runs.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_cleanup_runs.set_defaults(_handler=cmd_cleanup_runs)

    ap_list_frames = sub.add_parser(
        "list-frames",
        help="Print configured frame ids for one dataset",
        parents=[runtime],
    )
    ap_list_frames.set_defaults(_handler=cmd_list_frames)

    ap_list_datasets = sub.add_parser(
        "list-datasets",
        help="Print one configured dataset id per line",
        parents=[config],
    )
    ap_list_datasets.set_defaults(_handler=cmd_list_datasets)

    ap_smoke = sub.add_parser("smoke", help="Print a trivial health-check message and exit")
    ap_smoke.set_defaults(_handler=cmd_smoke)

    return ap


def main(argv: list[str] | None = None) -> int:
    """Run the forecast ETL CLI and return a process exit code."""

    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
