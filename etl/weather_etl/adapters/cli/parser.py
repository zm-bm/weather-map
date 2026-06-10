"""weather_etl CLI.

Subcommands:
- run-cycle: normal local full lifecycle for one dataset cycle
- submit-aws-cycle: manual AWS Batch frame-worker submission only
- init-run: lifecycle stage for immutable run config/catalog snapshots
- plan-cycle: lifecycle stage for read-only cycle worker planning
- run-frame: lifecycle stage for one frame worker
- validate-cycle: lifecycle stage for validation before publication
- publish-cycle: lifecycle stage for manifest publication
- runs: inspect known run attempts for one dataset cycle
- status: inspect one run attempt for one dataset cycle
- list-datasets: print configured dataset ids
- list-frames: print configured frame ids for one dataset
- smoke: trivial health/debug command for Batch smoke tests
"""

from __future__ import annotations

import argparse

from .arguments import add_artifact_filter_arg, config_parser, runtime_parser
from .handlers import (
    cmd_init_run,
    cmd_list_datasets,
    cmd_list_frames,
    cmd_plan_cycle,
    cmd_publish_cycle,
    cmd_run_cycle,
    cmd_run_frame,
    cmd_runs,
    cmd_smoke,
    cmd_status,
    cmd_submit_aws_cycle,
    cmd_validate_cycle,
)


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the `weather-etl` command-line parser."""

    ap = argparse.ArgumentParser(prog="weather-etl", description="Weather ETL")
    sub = ap.add_subparsers(dest="cmd", required=True)
    runtime = runtime_parser()
    config = config_parser()

    ap_run_cycle = sub.add_parser(
        "run-cycle",
        help="Run the normal local Docker lifecycle for one dataset cycle",
        description=(
            "Run the normal local Docker lifecycle: initialize, plan, run frame workers, "
            "validate, and publish unless --no-publish is set."
        ),
        parents=[runtime],
    )
    ap_run_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_run_cycle.add_argument(
        "--run-id",
        help="Run id for this local lifecycle attempt (default: generated once per run-cycle invocation)",
    )
    ap_run_cycle.add_argument("--frames", help='Configured frame subset, e.g. "000 003" or "000,003"')
    ap_run_cycle.add_argument("--artifacts-dir", required=True, help="Host artifacts directory mounted at /artifacts")
    ap_run_cycle.add_argument("--cache-dir", required=True, help="Host cache directory mounted in the worker")
    ap_run_cycle.add_argument("--local-image", required=True, help="Local worker image tag")
    ap_run_cycle.add_argument(
        "--procs",
        type=int,
        default=1,
        help="Maximum concurrent local worker containers",
    )
    ap_run_cycle.add_argument("--worker-stagger-seconds", type=float, default=0.0)
    ap_run_cycle.add_argument("--dry-run", action="store_true")
    ap_run_cycle.add_argument(
        "--no-publish",
        action="store_true",
        help="Skip the final publish step after local frame processing and validation",
    )
    add_artifact_filter_arg(ap_run_cycle)
    ap_run_cycle.set_defaults(_handler=cmd_run_cycle)

    ap_submit_aws = sub.add_parser(
        "submit-aws-cycle",
        help="Submit AWS Batch frame workers only; scheduled publisher validates/publishes later",
        description=(
            "Submit AWS Batch frame workers only. The scheduled publisher validates, "
            "publishes, and refreshes status.json later."
        ),
        parents=[runtime],
    )
    ap_submit_aws.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_submit_aws.add_argument("--run-id", help="Run id for this AWS worker submission attempt (default: generated)")
    ap_submit_aws.add_argument("--frames", help='Configured frame subset, e.g. "000 003" or "000,003"')
    ap_submit_aws.add_argument("--job-queue", required=True)
    ap_submit_aws.add_argument("--job-definition", required=True)
    ap_submit_aws.add_argument("--frame-claim-table", required=True)
    ap_submit_aws.add_argument("--source-bucket", default="noaa-gfs-bdp-pds")
    ap_submit_aws.add_argument("--job-name-prefix", default="weather-etl-manual")
    ap_submit_aws.add_argument("--submit-delay-seconds", type=float, default=0.0)
    ap_submit_aws.add_argument(
        "--force-backfill",
        action="store_true",
        help="Force submitting a cycle older than the current latest manifest",
    )
    ap_submit_aws.add_argument("--dry-run", action="store_true")
    add_artifact_filter_arg(ap_submit_aws)
    ap_submit_aws.set_defaults(_handler=cmd_submit_aws_cycle)

    ap_init_run = sub.add_parser(
        "init-run",
        help="Create or verify immutable config/catalog snapshots for one run",
        description="Lifecycle stage: create or verify immutable config/catalog snapshots for one run.",
        parents=[runtime],
    )
    ap_init_run.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_init_run.add_argument("--run-id", required=True, help="Run id")
    ap_init_run.set_defaults(_handler=cmd_init_run)

    ap_plan_cycle = sub.add_parser(
        "plan-cycle",
        help="Print a read-only cycle worker plan",
        description="Lifecycle stage: print a read-only cycle worker plan without running jobs.",
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

    ap_run_frame = sub.add_parser(
        "run-frame",
        help="Run one frame across configured artifacts",
        description="Lifecycle stage: run one frame across configured artifacts without publishing.",
        parents=[runtime],
    )
    ap_run_frame.add_argument("--cycle", help="Cycle YYYYMMDDHH (falls back to $CYCLE)")
    ap_run_frame.add_argument("--run-id", help="Run id (falls back to $RUN_ID)")
    ap_run_frame.add_argument("--frame-id", dest="frame_id", help="Frame id (falls back to $FRAME_ID)")
    ap_run_frame.add_argument(
        "--source-uri",
        help="Input source path or URI (local path, file:///..., s3://..., http(s)://...); falls back to $GRIB_SOURCE_URI",
    )
    add_artifact_filter_arg(ap_run_frame)
    ap_run_frame.set_defaults(_handler=cmd_run_frame)

    ap_validate_cycle = sub.add_parser(
        "validate-cycle",
        help="Validate one processed dataset cycle before publication",
        description="Lifecycle stage: validate one processed dataset cycle before publication.",
        parents=[runtime],
    )
    ap_validate_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_validate_cycle.add_argument(
        "--run-id",
        help="Optional run id to require while validating; otherwise derived from run objects",
    )
    ap_validate_cycle.set_defaults(_handler=cmd_validate_cycle)

    ap_publish_cycle = sub.add_parser(
        "publish-cycle",
        help="Publish manifests for one processed dataset cycle",
        description="Lifecycle stage: publish manifests for one processed dataset cycle.",
        parents=[runtime],
    )
    ap_publish_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_publish_cycle.add_argument(
        "--run-id",
        help="Optional run id to require while publishing; otherwise derived from success markers",
    )
    ap_publish_cycle.set_defaults(_handler=cmd_publish_cycle)

    ap_runs = sub.add_parser(
        "runs",
        help="Inspect known run attempts for one dataset cycle",
        description="Inspection: list known run attempts for one dataset cycle.",
        parents=[runtime],
    )
    ap_runs.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_runs.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_runs.set_defaults(_handler=cmd_runs)

    ap_status = sub.add_parser(
        "status",
        help="Inspect one run attempt for one dataset cycle",
        description="Inspection: explain one run attempt for one dataset cycle.",
        parents=[runtime],
    )
    ap_status.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_status.add_argument("--run-id", help="Optional run id to inspect; defaults to the only/newest run")
    ap_status.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_status.set_defaults(_handler=cmd_status)

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
    """Run the weather ETL CLI and return a process exit code."""

    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
