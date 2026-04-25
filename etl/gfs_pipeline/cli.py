"""gfs_pipeline CLI.

Subcommands:
- run-hour: run all scalar + vector outputs for one (cycle, fhour)
- run-cycle: prefetch GRIBs, fan out all forecast hours, and publish once
- smoke: trivial health/debug command for Batch smoke tests
"""

from __future__ import annotations

import os
import argparse
import time
from multiprocessing import Pool
from typing import Any

from . import nomads
from .config import PipelineConfig, ExecutionContext
from .worker import run_process_hour
from .publish import run_publish
from .layout import (
    parse_cycle,
    default_artifact_root_uri,
    default_pipeline_config_uri,
    file_uri,
    default_etl_dir,
    grib_cache_path
)


HourTask = tuple[
    ExecutionContext,
    dict[str, dict[str, Any]],
    tuple[str, ...],
    str,
    str,
    str,
    dict[str, dict[str, Any]],
]


def _runtime_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument(
        "--pipeline-config-uri",
        dest="pipeline_config_uri",
        default=os.environ.get("PIPELINE_CONFIG_URI") or default_pipeline_config_uri(),
        help="Pipeline config URI (file://, s3://, http(s)://).",
    )
    p.add_argument(
        "--artifact-root-uri",
        dest="artifact_root_uri",
        help="Artifact root URI (file://... or s3://...).",
        default=os.environ.get("ARTIFACT_ROOT_URI") or default_artifact_root_uri(),
    )
    return p


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="gfs_pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    runtime = _runtime_parser()

    ap_run_hour = sub.add_parser(
        "run-hour",
        help="Run one (cycle, fhour) across all configured scalar + vector outputs",
        parents=[runtime],
    )
    ap_run_hour.add_argument("--cycle", help="Cycle YYYYMMDDHH (falls back to $CYCLE)")
    ap_run_hour.add_argument("--fhour", help="Forecast hour FFF (falls back to $FHOUR)")
    ap_run_hour.add_argument(
        "--source-uri",
        help="Input GRIB2 URI (file://..., s3://..., http(s)://); falls back to $GRIB_SOURCE_URI",
    )
    ap_run_hour.add_argument(
        "--no-publish",
        action="store_true",
        help="Skip publish after processing this forecast hour",
    )
    ap_run_hour.set_defaults(_handler=_cmd_run_hour)

    ap_run_cycle = sub.add_parser(
        "run-cycle",
        help="Download/cache GRIBs, process all configured forecast hours, and publish once",
        parents=[runtime],
    )
    ap_run_cycle.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
    ap_run_cycle.add_argument(
        "--procs",
        type=int,
        default=4,
        help="Process count (default: 4; use 0 for cpu count)",
    )
    ap_run_cycle.add_argument(
        "--no-publish",
        action="store_true",
        help="Skip publish after processing all configured forecast hours",
    )
    ap_run_cycle.set_defaults(_handler=_cmd_run_cycle)

    ap_smoke = sub.add_parser("smoke", help="Print a trivial health-check message and exit")
    ap_smoke.set_defaults(_handler=_cmd_smoke)

    return ap


def _load_cfg_and_ctx(args: argparse.Namespace) -> tuple[PipelineConfig, ExecutionContext]:
    cfg = PipelineConfig.from_uri(args.pipeline_config_uri)
    ctx = cfg.to_execution_context(args.artifact_root_uri)
    return cfg, ctx


def _publish_cycle(*, ctx: ExecutionContext, cfg: PipelineConfig, cycle: str) -> None:
    run_publish(
        ctx=ctx,
        cycle=cycle,
        scalar_variables=cfg.workload.variables,
        vector_variables=cfg.vector_variables.keys(),
        scalar_variables_cfg=cfg.scalar_variables,
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


def _run_hour(
    *,
    cfg: PipelineConfig,
    ctx: ExecutionContext,
    cycle: str,
    fhour: str,
    source_uri: str,
    publish: bool,
) -> None:
    run_process_hour(
        ctx=ctx,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        scalar_variables=cfg.workload.variables,
        scalar_variables_cfg=cfg.scalar_variables,
        vector_variables_cfg=cfg.vector_variables,
    )
    if publish:
        _publish_cycle(ctx=ctx, cfg=cfg, cycle=cycle)


def _cmd_run_hour(args: argparse.Namespace) -> int:
    """Run one hour and publish by default."""
    cfg, ctx = _load_cfg_and_ctx(args)
    cycle = _require_str(args.cycle, env_name="CYCLE", cli_flag="--cycle")
    parse_cycle(cycle)
    fhour = _require_str(args.fhour, env_name="FHOUR", cli_flag="--fhour")
    source_uri = _require_str(args.source_uri, env_name="GRIB_SOURCE_URI", cli_flag="--source-uri")

    _run_hour(
        cfg=cfg,
        ctx=ctx,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        publish=not args.no_publish,
    )
    return 0


def _run_cycle_one(payload: HourTask) -> None:
    ctx, scalar_variables_cfg, scalar_variables, cycle, fhour, source_uri, vector_variables_cfg = payload
    run_process_hour(
        ctx=ctx,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        scalar_variables=scalar_variables,
        scalar_variables_cfg=scalar_variables_cfg,
        vector_variables_cfg=vector_variables_cfg,
    )


def _build_run_cycle_tasks(*, cfg: PipelineConfig, ctx: ExecutionContext, cycle: str) -> list[HourTask]:
    _, cycle_hour = parse_cycle(cycle)
    base_url, vars_levels = cfg.nomads.base_url, cfg.nomads.vars_levels

    etl_dir = default_etl_dir()
    fhours = cfg.workload.forecast_hours
    scalar_variables = tuple(cfg.workload.variables or ())
    tasks: list[HourTask] = []

    for fhour in fhours:
        local_path = grib_cache_path(etl_dir=etl_dir, cycle=cycle, cycle_hour=cycle_hour, fhour=fhour)

        if not local_path.exists():
            url = nomads.nomads_url(base_url=base_url, vars_levels=vars_levels, cycle=cycle, fhour=fhour)
            downloaded = nomads.download_if_needed(url, local_path)
            if downloaded and cfg.nomads.rate_limit_seconds > 0:
                time.sleep(cfg.nomads.rate_limit_seconds)

        if not local_path.exists():
            raise SystemExit(f"Missing GRIB after download attempt: {local_path}")

        source_uri = file_uri(local_path)
        tasks.append((ctx, cfg.scalar_variables, scalar_variables, cycle, fhour, source_uri, cfg.vector_variables))

    return tasks


def _cmd_run_cycle(args: argparse.Namespace) -> int:
    """Prefetch GRIBs, fan out workers locally, and publish once by default."""
    cfg, ctx = _load_cfg_and_ctx(args)
    cycle = str(args.cycle)
    parse_cycle(cycle)

    tasks = _build_run_cycle_tasks(cfg=cfg, ctx=ctx, cycle=cycle)
    procs = int(args.procs)
    with Pool(processes=None if procs <= 0 else procs) as pool:
        for _ in pool.imap_unordered(_run_cycle_one, tasks):
            pass

    if not args.no_publish:
        _publish_cycle(ctx=ctx, cfg=cfg, cycle=cycle)

    return 0


def _cmd_smoke(args: argparse.Namespace) -> int:
    del args
    print("hello world")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
