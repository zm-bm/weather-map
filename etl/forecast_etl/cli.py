"""forecast_etl CLI.

Subcommands:
- run-hour: run all configured artifacts for one (cycle, fhour)
- run-cycle: process all forecast hours for one model, and publish once
- publish-cycle: publish manifests for one processed model cycle
- list-models: print configured forecast model ids
- list-forecast-hours: print configured forecast hours for one model
- smoke: trivial health/debug command for Batch smoke tests
"""

from __future__ import annotations

import argparse
import os

from .commands import publish_cycle, run_cycle, run_hour
from .config.load import load_pipeline_config
from .config.resolved import PipelineConfig
from .cycles import parse_cycle
from .runtime import execution_context_for_model
from .storage.base import UriStore
from .storage.routing import make_store
from .uris import (
    default_artifact_root_uri,
    default_pipeline_config_uri,
)


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

    ap_run_hour = sub.add_parser(
        "run-hour",
        help="Run one (cycle, fhour) across all configured artifacts",
        parents=[runtime],
    )
    ap_run_hour.add_argument("--cycle", help="Cycle YYYYMMDDHH (falls back to $CYCLE)")
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
    ap_publish_cycle.set_defaults(_handler=_cmd_publish_cycle)

    ap_list_fhours = sub.add_parser(
        "list-forecast-hours",
        help="Print configured forecast hours for one model",
        parents=[runtime],
    )
    ap_list_fhours.set_defaults(_handler=_cmd_list_forecast_hours)

    ap_list_models = sub.add_parser(
        "list-models",
        help="Print configured forecast model ids",
        parents=[config],
    )
    ap_list_models.set_defaults(_handler=_cmd_list_models)

    ap_smoke = sub.add_parser("smoke", help="Print a trivial health-check message and exit")
    ap_smoke.set_defaults(_handler=_cmd_smoke)

    return ap


def _load_cfg(args: argparse.Namespace, *, store: UriStore | None = None) -> PipelineConfig:
    return load_pipeline_config(
        args.pipeline_config_uri,
        overlay_uri=args.pipeline_config_overlay_uri,
        store=store,
    )


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


def _resolve_artifact_ids(model, selected: list[str] | None) -> tuple[str, ...]:
    workload_artifacts = tuple(model.workload.artifacts or ())
    if not selected:
        return workload_artifacts

    requested = {artifact_id.strip() for artifact_id in selected if artifact_id.strip()}
    if not requested:
        raise SystemExit("--artifact requires at least one non-empty artifact id")

    unknown = sorted(requested - set(workload_artifacts))
    if unknown:
        raise SystemExit(
            f"Unknown artifact id(s) for model {model.id!r}: {unknown!r}; "
            f"configured artifacts: {list(workload_artifacts)!r}"
        )

    return tuple(artifact_id for artifact_id in workload_artifacts if artifact_id in requested)


def _cmd_run_hour(args: argparse.Namespace) -> int:
    """Run one hour without publishing."""
    store = make_store()
    cfg = _load_cfg(args, store=store)
    model = cfg.model(_require_model_id(args))
    ctx = execution_context_for_model(model, args.artifact_root_uri)
    cycle = _require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle")
    parse_cycle(cycle)
    fhour = _require_str(args.fhour, env_name="FHOUR", cli_flag="--fhour")
    source_uri = (
        args.source_uri
        if isinstance(args.source_uri, str) and args.source_uri.strip()
        else os.environ.get("GRIB_SOURCE_URI")
    )
    source_uri = source_uri.strip() if isinstance(source_uri, str) and source_uri.strip() else None

    run_hour(
        model=model,
        ctx=ctx,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        artifact_ids=_resolve_artifact_ids(model, args.artifacts),
        store=store,
    )
    return 0


def _cmd_run_cycle(args: argparse.Namespace) -> int:
    """Fan out model forecast-hour workers locally, and publish once by default."""
    store = make_store()
    cfg = _load_cfg(args, store=store)
    model = cfg.model(_require_model_id(args))
    ctx = execution_context_for_model(model, args.artifact_root_uri)
    cycle = str(args.cycle)
    parse_cycle(cycle)

    run_cycle(
        model=model,
        ctx=ctx,
        cycle=cycle,
        artifact_ids=_resolve_artifact_ids(model, args.artifacts),
        procs=args.procs,
        publish=not args.no_publish,
        pipeline_config=cfg,
        store=store,
    )
    return 0


def _cmd_publish_cycle(args: argparse.Namespace) -> int:
    """Publish one processed model cycle."""
    store = make_store()
    cfg = _load_cfg(args, store=store)
    model = cfg.model(_require_model_id(args))
    ctx = execution_context_for_model(model, args.artifact_root_uri)
    cycle = str(args.cycle)
    parse_cycle(cycle)

    result = publish_cycle(
        model=model,
        ctx=ctx,
        cycle=cycle,
        pipeline_config=cfg,
        store=store,
    )
    return 0 if result.ready else 2


def _cmd_list_forecast_hours(args: argparse.Namespace) -> int:
    """Print one configured forecast-hour id per line."""
    cfg = _load_cfg(args, store=make_store())
    model = cfg.model(_require_model_id(args))
    for fhour in model.workload.forecast_hours:
        print(fhour)
    return 0


def _cmd_list_models(args: argparse.Namespace) -> int:
    """Print one configured forecast model id per line."""
    cfg = _load_cfg(args, store=make_store())
    for model_id in cfg.models:
        print(model_id)
    return 0


def _cmd_smoke(args: argparse.Namespace) -> int:
    del args
    print("hello world")
    return 0


def main(argv: list[str] | None = None) -> int:
    """Run the forecast ETL CLI and return a process exit code."""

    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
