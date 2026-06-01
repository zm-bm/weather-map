"""forecast_etl CLI.

Subcommands:
- init-run: create or verify immutable run config/catalog snapshots
- run-hour: run all configured artifacts for one (cycle, fhour)
- run-cycle: process all forecast hours for one model, and publish once
- publish-cycle: publish manifests for one processed model cycle
- validate-cycle: validate one processed model cycle before publication
- list-models: print configured forecast model ids
- list-forecast-hours: print configured forecast hours for one model
- smoke: trivial health/debug command for Batch smoke tests
"""

from __future__ import annotations

import argparse
import os

from .catalog import load_forecast_catalog
from .commands import publish_cycle, run_cycle, run_hour
from .config.load import LoadedPipelineConfig, load_pipeline_config, load_pipeline_config_document
from .config.resolved import PipelineConfig
from .cycles import parse_cycle
from .run_ids import generate_run_id, parse_run_id
from .run_metadata import RunSnapshot, json_document_digest, run_metadata_from_env
from .run_snapshots import ensure_run_snapshot, load_run_snapshot, select_run_id_for_cycle
from .run_validation import validate_run
from .runtime import execution_context_for_model
from .storage.base import UriStore
from .storage.routing import make_store
from .uris import (
    default_artifact_root_uri,
    default_forecast_catalog_uri,
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


def _load_cfg_document(args: argparse.Namespace, *, store: UriStore | None = None) -> LoadedPipelineConfig:
    return load_pipeline_config_document(
        args.pipeline_config_uri,
        overlay_uri=args.pipeline_config_overlay_uri,
        store=store,
    )


def _run_snapshot(args: argparse.Namespace, *, store: UriStore, loaded: LoadedPipelineConfig) -> RunSnapshot:
    return RunSnapshot(
        metadata=run_metadata_from_env(config_digest=json_document_digest(loaded.raw)),
        pipeline_config=loaded.raw,
        forecast_catalog=load_forecast_catalog(catalog_uri=args.forecast_catalog_uri, store=store),
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
    loaded = _load_cfg_document(args, store=store)
    cfg = loaded.config
    model = cfg.model(_require_model_id(args))
    ctx = execution_context_for_model(model, args.artifact_root_uri)
    cycle = _require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle")
    parse_cycle(cycle)
    run_id = parse_run_id(_require_str(getattr(args, "run_id", None), env_name="RUN_ID", cli_flag="--run-id"))
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
        run_id=run_id,
        fhour=fhour,
        source_uri=source_uri,
        artifact_ids=_resolve_artifact_ids(model, args.artifacts),
        store=store,
        run_snapshot=_run_snapshot(args, store=store, loaded=loaded),
    )
    return 0


def _cmd_init_run(args: argparse.Namespace) -> int:
    """Create or verify immutable run config/catalog snapshots."""
    store = make_store()
    model_id = _require_model_id(args)
    cycle = str(args.cycle)
    parse_cycle(cycle)
    run_id = parse_run_id(args.run_id)
    artifact_repo = _artifact_repo(args, store=store)
    loaded = ensure_run_snapshot(
        artifact_repo=artifact_repo,
        store=store,
        model_id=model_id,
        cycle=cycle,
        run_id=run_id,
        pipeline_config_uri=args.pipeline_config_uri,
        pipeline_config_overlay_uri=args.pipeline_config_overlay_uri,
        forecast_catalog_uri=args.forecast_catalog_uri,
    )
    print(f"run_id={loaded.run_id}")
    print(f"config_digest={loaded.config_digest}")
    print(f"pipeline_config_uri={loaded.pipeline_config_uri}")
    print(f"forecast_catalog_uri={loaded.forecast_catalog_uri}")
    return 0


def _cmd_run_cycle(args: argparse.Namespace) -> int:
    """Fan out model forecast-hour workers locally, and publish once by default."""
    store = make_store()
    loaded = _load_cfg_document(args, store=store)
    cfg = loaded.config
    model = cfg.model(_require_model_id(args))
    ctx = execution_context_for_model(model, args.artifact_root_uri)
    cycle = str(args.cycle)
    parse_cycle(cycle)
    run_id = parse_run_id(args.run_id) if args.run_id else generate_run_id()
    run_snapshot = _run_snapshot(args, store=store, loaded=loaded)
    loaded_run_snapshot = ensure_run_snapshot(
        artifact_repo=_artifact_repo(args, store=store),
        store=store,
        model_id=model.id,
        cycle=cycle,
        run_id=run_id,
        pipeline_config_uri=args.pipeline_config_uri,
        pipeline_config_overlay_uri=args.pipeline_config_overlay_uri,
        forecast_catalog_uri=args.forecast_catalog_uri,
    )

    run_cycle(
        model=model,
        ctx=ctx,
        cycle=cycle,
        run_id=run_id,
        artifact_ids=_resolve_artifact_ids(model, args.artifacts),
        procs=args.procs,
        publish=not args.no_publish,
        pipeline_config=cfg,
        store=store,
        run_snapshot=run_snapshot,
        loaded_run_snapshot=loaded_run_snapshot,
    )
    return 0


def _cmd_publish_cycle(args: argparse.Namespace) -> int:
    """Publish one processed model cycle."""
    store = make_store()
    model_id = _require_model_id(args)
    cycle = str(args.cycle)
    parse_cycle(cycle)
    required_run_id = parse_run_id(args.run_id) if args.run_id else None
    artifact_repo = _artifact_repo(args, store=store)
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=artifact_repo,
        model_id=model_id,
        cycle=cycle,
        required_run_id=required_run_id,
    )
    if run_errors or run_id is None:
        print(f"Publish not ready: run selection failed for model={model_id} cycle={cycle}")
        for error in run_errors:
            print(f"run error: {error}")
        return 2
    try:
        snapshot = load_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
        )
    except FileNotFoundError as exc:
        print(f"Publish not ready: {exc}")
        return 2

    cfg = snapshot.loaded_config.config
    model = cfg.model(model_id)
    ctx = execution_context_for_model(model, args.artifact_root_uri)

    result = publish_cycle(
        model=model,
        ctx=ctx,
        cycle=cycle,
        run_id=run_id,
        pipeline_config=cfg,
        forecast_catalog=snapshot.forecast_catalog,
        store=store,
    )
    return 0 if result.ready else 2


def _cmd_validate_cycle(args: argparse.Namespace) -> int:
    """Validate one processed model cycle."""
    store = make_store()
    model_id = _require_model_id(args)
    cycle = str(args.cycle)
    parse_cycle(cycle)
    required_run_id = parse_run_id(args.run_id) if args.run_id else None
    artifact_repo = _artifact_repo(args, store=store)
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=artifact_repo,
        model_id=model_id,
        cycle=cycle,
        required_run_id=required_run_id,
    )
    if run_errors or run_id is None:
        print(f"Validation not ready: run selection failed for model={model_id} cycle={cycle}")
        for error in run_errors:
            print(f"run error: {error}")
        return 2
    try:
        snapshot = load_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
        )
    except FileNotFoundError as exc:
        print(f"Validation not ready: {exc}")
        return 2

    model = snapshot.loaded_config.config.model(model_id)
    result = validate_run(
        artifact_repo=artifact_repo,
        model=model,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return 0 if result.passed else 2


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


def _artifact_repo(args: argparse.Namespace, *, store: UriStore):
    from .artifacts.repository import ArtifactRepository

    return ArtifactRepository.for_root(store=store, artifact_root_uri=args.artifact_root_uri)


def main(argv: list[str] | None = None) -> int:
    """Run the forecast ETL CLI and return a process exit code."""

    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
