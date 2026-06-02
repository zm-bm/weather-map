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
import json
import os
from pathlib import Path

import boto3  # type: ignore

from .frame_claims import DynamoFrameClaimStore
from .storage.base import UriStore
from .storage.routing import make_store
from .uris import (
    default_artifact_root_uri,
    default_forecast_catalog_uri,
    default_pipeline_config_uri,
)
from .workflows import cycle as cycle_workflow
from .workflows import inspection as inspection_workflow
from .workflows.context import ApplicationContext
from .workflows.executors import execute_local_docker_cycle, parse_optional_frames, submit_aws_batch_cycle
from .workflows.planning import parse_frame_selection, plan_cycle


def _config_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument(
        "--pipeline-config-uri",
        dest="pipeline_config_uri",
        default=os.environ.get("PIPELINE_CONFIG_URI") or default_pipeline_config_uri(),
        help="Pipeline config URI (file://, s3://, http(s)://).",
    )
    p.add_argument(
        "--pipeline-config-overlay-uri",
        dest="pipeline_config_overlay_uri",
        default=os.environ.get("PIPELINE_CONFIG_OVERLAY_URI") or None,
        help="Optional local/dev pipeline config overlay URI.",
    )
    p.add_argument(
        "--forecast-catalog-uri",
        dest="forecast_catalog_uri",
        default=os.environ.get("FORECAST_CATALOG_URI") or default_forecast_catalog_uri(),
        help="Forecast catalog URI (file://, s3://, http(s)://).",
    )
    return p


def _runtime_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False, parents=[_config_parser()])
    p.add_argument(
        "--artifact-root-uri",
        dest="artifact_root_uri",
        help="Artifact root URI (file://... or s3://...).",
        default=os.environ.get("ARTIFACT_ROOT_URI") or default_artifact_root_uri(),
    )
    p.add_argument(
        "--dataset-id",
        dest="dataset_id",
        default=os.environ.get("DATASET_ID"),
        help="Dataset id (required; also accepts $DATASET_ID).",
    )
    return p


def build_arg_parser() -> argparse.ArgumentParser:
    """Build the `forecast-etl` command-line parser."""

    ap = argparse.ArgumentParser(description="forecast_etl")
    sub = ap.add_subparsers(dest="cmd", required=True)
    runtime = _runtime_parser()
    config = _config_parser()

    ap_init_run = sub.add_parser(
        "init-run",
        help="Create or verify immutable config/catalog snapshots for one run",
        parents=[runtime],
    )
    ap_init_run.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_init_run.add_argument("--run-id", required=True, help="Run id")
    ap_init_run.set_defaults(_handler=_cmd_init_run)

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
    ap_check_backfill.set_defaults(_handler=_cmd_check_backfill)

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
    _add_artifact_filter_arg(ap_run_frame)
    ap_run_frame.set_defaults(_handler=_cmd_run_frame)

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
    _add_artifact_filter_arg(ap_run_cycle)
    ap_run_cycle.set_defaults(_handler=_cmd_run_cycle)

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
    _add_artifact_filter_arg(ap_plan_cycle)
    ap_plan_cycle.set_defaults(_handler=_cmd_plan_cycle)

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
    _add_artifact_filter_arg(ap_execute_local)
    ap_execute_local.set_defaults(_handler=_cmd_execute_local_cycle)

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
    _add_artifact_filter_arg(ap_submit_aws)
    ap_submit_aws.set_defaults(_handler=_cmd_submit_aws_cycle)

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
    ap_publish_cycle.set_defaults(_handler=_cmd_publish_cycle)

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
    ap_validate_cycle.set_defaults(_handler=_cmd_validate_cycle)

    ap_runs = sub.add_parser(
        "runs",
        help="Inspect known run attempts for one dataset cycle",
        parents=[runtime],
    )
    ap_runs.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_runs.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_runs.set_defaults(_handler=_cmd_runs)

    ap_status = sub.add_parser(
        "status",
        help="Inspect one run attempt for one dataset cycle",
        parents=[runtime],
    )
    ap_status.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_status.add_argument("--run-id", help="Optional run id to inspect; defaults to the only/newest run")
    ap_status.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_status.set_defaults(_handler=_cmd_status)

    ap_pointers = sub.add_parser(
        "pointers",
        help="Inspect public manifest pointers for one dataset",
        parents=[runtime],
    )
    ap_pointers.add_argument("--cycle", help="Optional cycle YYYYMMDDHH for current pointer inspection")
    ap_pointers.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_pointers.set_defaults(_handler=_cmd_pointers)

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
    ap_cleanup_runs.set_defaults(_handler=_cmd_cleanup_runs)

    ap_list_frames = sub.add_parser(
        "list-frames",
        help="Print configured frame ids for one dataset",
        parents=[runtime],
    )
    ap_list_frames.set_defaults(_handler=_cmd_list_frames)

    ap_list_datasets = sub.add_parser(
        "list-datasets",
        help="Print one configured dataset id per line",
        parents=[config],
    )
    ap_list_datasets.set_defaults(_handler=_cmd_list_datasets)

    ap_smoke = sub.add_parser("smoke", help="Print a trivial health-check message and exit")
    ap_smoke.set_defaults(_handler=_cmd_smoke)

    return ap


def _require_str(
    value: str | None,
    *,
    env_name: str,
    cli_flag: str,
) -> str:
    resolved = value if isinstance(value, str) and value.strip() else os.environ.get(env_name, "")
    if not isinstance(resolved, str) or not resolved.strip():
        raise SystemExit(f"Missing required input: {cli_flag} or ${env_name}")
    return resolved.strip()


def _require_dataset_id(args: argparse.Namespace) -> str:
    return _require_str(args.dataset_id, env_name="DATASET_ID", cli_flag="--dataset-id")


def _add_artifact_filter_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--artifact",
        dest="artifacts",
        action="append",
        default=None,
        help="Artifact id to process; repeat to process multiple artifacts.",
    )


def _cmd_run_frame(args: argparse.Namespace) -> int:
    """Run one frame without publishing."""

    source_uri = (
        args.source_uri
        if isinstance(args.source_uri, str) and args.source_uri.strip()
        else os.environ.get("GRIB_SOURCE_URI")
    )
    source_uri = source_uri.strip() if isinstance(source_uri, str) and source_uri.strip() else None

    cycle_workflow.process_frame(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=_require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle"),
        run_id=_require_str(getattr(args, "run_id", None), env_name="RUN_ID", cli_flag="--run-id"),
        frame_id=_require_str(args.frame_id, env_name="FRAME_ID", cli_flag="--frame-id"),
        source_uri=source_uri,
        artifact_ids=args.artifacts,
    )
    return 0


def _cmd_check_backfill(args: argparse.Namespace) -> int:
    """Guard against accidental older-than-latest submits."""

    result = cycle_workflow.check_backfill(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle),
        allow_backfill=bool(args.backfill),
    )
    for key, value in result.key_values():
        print(f"{key}={value}")
    return 0 if result.ok else 2


def _cmd_init_run(args: argparse.Namespace) -> int:
    """Create or verify immutable run config/catalog snapshots."""

    result = cycle_workflow.init_run(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    print(f"run_id={result.run_id}")
    print(f"config_digest={result.config_digest}")
    print(f"pipeline_config_uri={result.pipeline_config_uri}")
    print(f"forecast_catalog_uri={result.forecast_catalog_uri}")
    return 0


def _cmd_run_cycle(args: argparse.Namespace) -> int:
    """Fan out dataset frame workers locally, and publish once by default."""

    cycle_workflow.process_cycle(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        artifact_ids=args.artifacts,
        procs=args.procs,
        publish=not args.no_publish,
    )
    return 0


def _cmd_plan_cycle(args: argparse.Namespace) -> int:
    """Print a read-only provider-neutral cycle plan."""

    result = plan_cycle(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        selected_frames=parse_frame_selection(args.frames),
        selected_artifacts=args.artifacts,
        publish=not args.no_publish,
    )
    _print_operator_report(result.plan, as_json=bool(args.json))
    return 0


def _cmd_execute_local_cycle(args: argparse.Namespace) -> int:
    """Execute a cycle plan with local Docker workers."""

    if args.procs < 1:
        raise SystemExit("--procs must be at least 1")
    results = execute_local_docker_cycle(
        app_context=_app_context(args),
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


def _cmd_submit_aws_cycle(args: argparse.Namespace) -> int:
    """Submit a cycle plan to AWS Batch."""

    ddb = boto3.client("dynamodb")
    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=str(args.frame_claim_table))
    result = submit_aws_batch_cycle(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
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


def _cmd_publish_cycle(args: argparse.Namespace) -> int:
    """Publish one processed dataset cycle."""

    dataset_id = _require_dataset_id(args)
    cycle = str(args.cycle)
    result = cycle_workflow.publish_cycle(
        app_context=_app_context(args),
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready and result.publish_result is None:
        _print_not_ready(label="Publish", dataset_id=dataset_id, cycle=cycle, result=result)
        return 2
    return 0 if result.ready else 2


def _cmd_validate_cycle(args: argparse.Namespace) -> int:
    """Validate one processed dataset cycle."""

    dataset_id = _require_dataset_id(args)
    cycle = str(args.cycle)
    result = cycle_workflow.validate_cycle(
        app_context=_app_context(args),
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready:
        _print_not_ready(label="Validation", dataset_id=dataset_id, cycle=cycle, result=result)
        return 2
    return 0 if result.passed else 2


def _cmd_runs(args: argparse.Namespace) -> int:
    """Inspect known runs for one dataset cycle."""

    report = inspection_workflow.runs(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle),
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 0


def _cmd_status(args: argparse.Namespace) -> int:
    """Inspect one run for one dataset cycle."""

    report = inspection_workflow.status(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 0


def _cmd_pointers(args: argparse.Namespace) -> int:
    """Inspect public manifest pointers for one dataset."""

    report = inspection_workflow.pointers(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle) if args.cycle else None,
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 0


def _cmd_cleanup_runs(args: argparse.Namespace) -> int:
    """Report or delete run cleanup candidates."""

    if args.delete and not args.yes:
        raise SystemExit("cleanup-runs --delete requires --yes")
    report = inspection_workflow.cleanup_runs(
        app_context=_app_context(args),
        dataset_id=_require_dataset_id(args),
        cycle=str(args.cycle) if args.cycle else None,
        delete_candidates=bool(args.delete),
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 2 if int(report.get("delete_error_count") or 0) else 0


def _cmd_list_frames(args: argparse.Namespace) -> int:
    """Print one configured forecast-hour id per line."""

    cfg = _app_context(args).load_pipeline_config()
    dataset = cfg.dataset(_require_dataset_id(args))
    for frame_id in dataset.workload.frames:
        print(frame_id)
    return 0


def _cmd_list_datasets(args: argparse.Namespace) -> int:
    """Print one configured dataset id per line."""

    cfg = _app_context(args).load_pipeline_config()
    for dataset_id in cfg.datasets:
        print(dataset_id)
    return 0


def _cmd_smoke(args: argparse.Namespace) -> int:
    del args
    print("hello world")
    return 0


def _app_context(args: argparse.Namespace, *, store: UriStore | None = None) -> ApplicationContext:
    return ApplicationContext(
        artifact_root_uri=getattr(args, "artifact_root_uri", None) or default_artifact_root_uri(),
        pipeline_config_uri=getattr(args, "pipeline_config_uri", None) or default_pipeline_config_uri(),
        pipeline_config_overlay_uri=getattr(args, "pipeline_config_overlay_uri", None),
        forecast_catalog_uri=getattr(args, "forecast_catalog_uri", None) or default_forecast_catalog_uri(),
        store=store if store is not None else make_store(),
    )


def _print_not_ready(*, label: str, dataset_id: str, cycle: str, result: object) -> None:
    message = getattr(result, "message", None)
    errors = tuple(getattr(result, "errors", ()) or ())
    if message and not message.startswith("run selection failed"):
        print(f"{label} not ready: {message}")
        return
    print(f"{label} not ready: run selection failed for dataset_id={dataset_id} cycle={cycle}")
    if message and not errors:
        print(f"run error: {message}")
    for error in errors:
        print(f"run error: {error}")


def _print_operator_report(report: dict, *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(report, sort_keys=True, indent=2))
        return
    _print_key_values(report)


def _print_key_values(value: object, *, prefix: str = "") -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_prefix = f"{prefix}.{key}" if prefix else str(key)
            _print_key_values(nested, prefix=nested_prefix)
        return
    if isinstance(value, list):
        if all(not isinstance(item, (dict, list)) for item in value):
            print(f"{prefix}={','.join(_operator_value(item) for item in value)}")
            return
        for index, item in enumerate(value):
            _print_key_values(item, prefix=f"{prefix}.{index}")
        return
    print(f"{prefix}={_operator_value(value)}")


def _operator_value(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def main(argv: list[str] | None = None) -> int:
    """Run the forecast ETL CLI and return a process exit code."""

    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
