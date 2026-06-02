"""forecast_etl CLI.

Subcommands:
- check-backfill: guard against accidental older-than-latest submits
- init-run: create or verify immutable run config/catalog snapshots
- run-hour: run all configured artifacts for one (cycle, fhour)
- run-cycle: process all forecast hours for one model, and publish once
- publish-cycle: publish manifests for one processed model cycle
- validate-cycle: validate one processed model cycle before publication
- runs: inspect known run attempts for one model cycle
- status: inspect one run attempt for one model cycle
- pointers: inspect public manifest pointers for one model
- cleanup-runs: report run cleanup candidates without deleting objects
- list-models: print configured forecast model ids
- list-forecast-hours: print configured forecast hours for one model
- smoke: trivial health/debug command for Batch smoke tests
"""

from __future__ import annotations

import argparse
import json
import os

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
        "--model",
        dest="model",
        default=os.environ.get("MODEL"),
        help="Forecast model id (required; also accepts $MODEL).",
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

    ap_run_hour = sub.add_parser(
        "run-hour",
        help="Run one (cycle, fhour) across all configured artifacts",
        parents=[runtime],
    )
    ap_run_hour.add_argument("--cycle", help="Cycle YYYYMMDDHH (falls back to $CYCLE)")
    ap_run_hour.add_argument("--run-id", help="Run id (falls back to $RUN_ID)")
    ap_run_hour.add_argument("--fhour", help="Forecast hour FFF (falls back to $FHOUR)")
    ap_run_hour.add_argument(
        "--source-uri",
        help="Input model source URI (file://..., s3://..., http(s)://); falls back to $GRIB_SOURCE_URI",
    )
    _add_artifact_filter_arg(ap_run_hour)
    ap_run_hour.set_defaults(_handler=_cmd_run_hour)

    ap_run_cycle = sub.add_parser(
        "run-cycle",
        help="Process all configured forecast hours for one model, and publish once",
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
        help="Skip publish after processing all configured forecast hours",
    )
    _add_artifact_filter_arg(ap_run_cycle)
    ap_run_cycle.set_defaults(_handler=_cmd_run_cycle)

    ap_publish_cycle = sub.add_parser(
        "publish-cycle",
        help="Publish manifests for one processed forecast cycle",
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
        help="Inspect known run attempts for one model cycle",
        parents=[runtime],
    )
    ap_runs.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_runs.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_runs.set_defaults(_handler=_cmd_runs)

    ap_status = sub.add_parser(
        "status",
        help="Inspect one run attempt for one model cycle",
        parents=[runtime],
    )
    ap_status.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_status.add_argument("--run-id", help="Optional run id to inspect; defaults to the only/newest run")
    ap_status.add_argument("--json", action="store_true", help="Emit structured JSON")
    ap_status.set_defaults(_handler=_cmd_status)

    ap_pointers = sub.add_parser(
        "pointers",
        help="Inspect public manifest pointers for one model",
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

    ap_list_fhours = sub.add_parser(
        "list-forecast-hours",
        help="Print configured forecast hours for one model",
        parents=[runtime],
    )
    ap_list_fhours.set_defaults(_handler=_cmd_list_forecast_hours)

    ap_list_models = sub.add_parser(
        "list-models",
        help="Print one configured forecast model id per line",
        parents=[config],
    )
    ap_list_models.set_defaults(_handler=_cmd_list_models)

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


def _require_model_id(args: argparse.Namespace) -> str:
    return _require_str(args.model, env_name="MODEL", cli_flag="--model")


def _add_artifact_filter_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--artifact",
        dest="artifacts",
        action="append",
        default=None,
        help="Artifact id to process; repeat to process multiple artifacts.",
    )


def _cmd_run_hour(args: argparse.Namespace) -> int:
    """Run one hour without publishing."""

    source_uri = (
        args.source_uri
        if isinstance(args.source_uri, str) and args.source_uri.strip()
        else os.environ.get("GRIB_SOURCE_URI")
    )
    source_uri = source_uri.strip() if isinstance(source_uri, str) and source_uri.strip() else None

    cycle_workflow.process_hour(
        app_context=_app_context(args),
        model_id=_require_model_id(args),
        cycle=_require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle"),
        run_id=_require_str(getattr(args, "run_id", None), env_name="RUN_ID", cli_flag="--run-id"),
        fhour=_require_str(args.fhour, env_name="FHOUR", cli_flag="--fhour"),
        source_uri=source_uri,
        artifact_ids=args.artifacts,
    )
    return 0


def _cmd_check_backfill(args: argparse.Namespace) -> int:
    """Guard against accidental older-than-latest submits."""

    result = cycle_workflow.check_backfill(
        app_context=_app_context(args),
        model_id=_require_model_id(args),
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
        model_id=_require_model_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    print(f"run_id={result.run_id}")
    print(f"config_digest={result.config_digest}")
    print(f"pipeline_config_uri={result.pipeline_config_uri}")
    print(f"forecast_catalog_uri={result.forecast_catalog_uri}")
    return 0


def _cmd_run_cycle(args: argparse.Namespace) -> int:
    """Fan out model forecast-hour workers locally, and publish once by default."""

    cycle_workflow.process_cycle(
        app_context=_app_context(args),
        model_id=_require_model_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
        artifact_ids=args.artifacts,
        procs=args.procs,
        publish=not args.no_publish,
    )
    return 0


def _cmd_publish_cycle(args: argparse.Namespace) -> int:
    """Publish one processed model cycle."""

    model_id = _require_model_id(args)
    cycle = str(args.cycle)
    result = cycle_workflow.publish_cycle(
        app_context=_app_context(args),
        model_id=model_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready and result.publish_result is None:
        _print_not_ready(label="Publish", model_id=model_id, cycle=cycle, result=result)
        return 2
    return 0 if result.ready else 2


def _cmd_validate_cycle(args: argparse.Namespace) -> int:
    """Validate one processed model cycle."""

    model_id = _require_model_id(args)
    cycle = str(args.cycle)
    result = cycle_workflow.validate_cycle(
        app_context=_app_context(args),
        model_id=model_id,
        cycle=cycle,
        required_run_id=args.run_id,
    )
    if not result.ready:
        _print_not_ready(label="Validation", model_id=model_id, cycle=cycle, result=result)
        return 2
    return 0 if result.passed else 2


def _cmd_runs(args: argparse.Namespace) -> int:
    """Inspect known runs for one model cycle."""

    report = inspection_workflow.runs(
        app_context=_app_context(args),
        model_id=_require_model_id(args),
        cycle=str(args.cycle),
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 0


def _cmd_status(args: argparse.Namespace) -> int:
    """Inspect one run for one model cycle."""

    report = inspection_workflow.status(
        app_context=_app_context(args),
        model_id=_require_model_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 0


def _cmd_pointers(args: argparse.Namespace) -> int:
    """Inspect public manifest pointers for one model."""

    report = inspection_workflow.pointers(
        app_context=_app_context(args),
        model_id=_require_model_id(args),
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
        model_id=_require_model_id(args),
        cycle=str(args.cycle) if args.cycle else None,
        delete_candidates=bool(args.delete),
    )
    _print_operator_report(report, as_json=bool(args.json))
    return 2 if int(report.get("deleteErrorCount") or 0) else 0


def _cmd_list_forecast_hours(args: argparse.Namespace) -> int:
    """Print one configured forecast-hour id per line."""

    cfg = _app_context(args).load_pipeline_config()
    model = cfg.model(_require_model_id(args))
    for fhour in model.workload.forecast_hours:
        print(fhour)
    return 0


def _cmd_list_models(args: argparse.Namespace) -> int:
    """Print one configured forecast model id per line."""

    cfg = _app_context(args).load_pipeline_config()
    for model_id in cfg.models:
        print(model_id)
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


def _print_not_ready(*, label: str, model_id: str, cycle: str, result: object) -> None:
    message = getattr(result, "message", None)
    errors = tuple(getattr(result, "errors", ()) or ())
    if message and not message.startswith("run selection failed"):
        print(f"{label} not ready: {message}")
        return
    print(f"{label} not ready: run selection failed for model={model_id} cycle={cycle}")
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
