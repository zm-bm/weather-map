"""weather_etl CLI.

Subcommands:
- submit-aws-run: manual AWS Batch frame-worker submission only
- run-frame: lifecycle stage for one frame worker
"""

from __future__ import annotations

import argparse

from .arguments import add_artifact_filter_arg, runtime_parser
from .handlers import cmd_run_frame, cmd_submit_aws_run


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the `weather-etl` command-line parser."""

    ap = argparse.ArgumentParser(prog="weather-etl", description="Weather ETL")
    sub = ap.add_subparsers(dest="cmd", required=True)
    runtime = runtime_parser()

    ap_submit_aws = sub.add_parser(
        "submit-aws-run",
        help="Submit AWS Batch frame workers only; scheduled publisher validates/publishes later",
        description=(
            "Submit AWS Batch frame workers only. The scheduled publisher validates, "
            "publishes, and refreshes status.json later."
        ),
        parents=[runtime],
    )
    ap_submit_aws.add_argument("--cycle", required=True, help="Forecast cycle or observed hourly bucket YYYYMMDDHH")
    ap_submit_aws.add_argument("--run-id", help="Run id for this AWS worker submission attempt (default: generated)")
    ap_submit_aws.add_argument("--frames", help='Configured frame subset, e.g. "000 003" or "000,003"')
    ap_submit_aws.add_argument("--job-queue", required=True)
    ap_submit_aws.add_argument("--job-definition", required=True)
    ap_submit_aws.add_argument("--frame-claim-table", required=True)
    ap_submit_aws.add_argument("--source-bucket", default="noaa-gfs-bdp-pds")
    ap_submit_aws.add_argument("--job-name-prefix", default="weather-etl-manual")
    ap_submit_aws.add_argument("--submit-delay-seconds", type=float, default=0.0)
    ap_submit_aws.add_argument("--dry-run", action="store_true")
    add_artifact_filter_arg(ap_submit_aws)
    ap_submit_aws.set_defaults(_handler=cmd_submit_aws_run)

    ap_run_frame = sub.add_parser(
        "run-frame",
        help="Run one frame across configured artifacts",
        description="Lifecycle stage: run one frame across configured artifacts without publishing.",
        parents=[runtime],
    )
    ap_run_frame.add_argument("--cycle", help="Forecast cycle or observed hourly bucket YYYYMMDDHH (falls back to $CYCLE)")
    ap_run_frame.add_argument("--run-id", help="Run id (falls back to $RUN_ID)")
    ap_run_frame.add_argument("--frame-id", dest="frame_id", help="Frame id (falls back to $FRAME_ID)")
    ap_run_frame.add_argument(
        "--source-uri",
        help="Input source path or URI (local path, file:///..., s3://..., http(s)://...); falls back to $GRIB_SOURCE_URI",
    )
    add_artifact_filter_arg(ap_run_frame)
    ap_run_frame.set_defaults(_handler=cmd_run_frame)

    return ap

def main(argv: list[str] | None = None) -> int:
    """Run the weather ETL CLI and return a process exit code."""

    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
