"""gfs_pipeline CLI.

Subcommands:
- process-hour: run all scalar + vector outputs for one (cycle, fhour)
- publish: publish cycle artifacts
- dev-run: local fanout runner (multiprocessing)
"""

from __future__ import annotations

import os
import argparse
import time
from multiprocessing import Pool

from . import nomads
from .config import PipelineConfig, ExecutionContext
from .worker import run_process_hour
from .publish import run_publish
from .layout import (
    parse_cycle,
    default_artifact_root_uri,
    default_pipeline_config_uri,
    default_etl_dir,
    file_uri,
    grib_cache_path
)


def _common_subcommand_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--cycle", required=True, help="Cycle YYYYMMDDHH")
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
    common = _common_subcommand_parser()

    ap_process_hour = sub.add_parser(
        "process-hour",
        help="Run one (cycle, fhour) across all configured scalar + vector outputs",
        parents=[common],
    )
    ap_process_hour.add_argument("--fhour", required=True, help="Forecast hour FFF")
    ap_process_hour.add_argument("--source-uri", required=True, help="Input GRIB2 URI (file://...)")
    ap_process_hour.set_defaults(_handler=_cmd_process_hour)

    ap_publish = sub.add_parser("publish", help="Publish cycle manifests/markers", parents=[common])
    ap_publish.set_defaults(_handler=_cmd_publish)

    ap_dev = sub.add_parser("dev-run", help="Fan out locally (multiprocessing)", parents=[common])
    ap_dev.add_argument("--procs", type=int, default=4, help="Process count (default: 4; use 0 for cpu count)")
    ap_dev.set_defaults(_handler=_cmd_dev_run)

    return ap


def _cmd_process_hour(args: argparse.Namespace) -> int:
    """Run all configured outputs for one (cycle, fhour)."""
    cfg = PipelineConfig.from_uri(args.pipeline_config_uri)
    ctx = cfg.to_execution_context(args.artifact_root_uri)

    run_process_hour(
        ctx=ctx,
        cycle=str(args.cycle),
        fhour=str(args.fhour),
        source_uri=str(args.source_uri),
        scalar_variables=cfg.workload.variables,
        scalar_variables_cfg=cfg.scalar_variables,
        vector_variables_cfg=cfg.vector_variables,
    )
    return 0


def _cmd_publish(args: argparse.Namespace) -> int:
    """Publish a cycle (write manifests/markers when ready)."""
    cfg = PipelineConfig.from_uri(args.pipeline_config_uri)
    ctx = cfg.to_execution_context(args.artifact_root_uri)

    run_publish(
        ctx=ctx,
        cycle=str(args.cycle),
        scalar_variables=cfg.workload.variables,
        vector_variables=cfg.vector_variables.keys(),
        scalar_variables_cfg=cfg.scalar_variables,
    )
    return 0


def _dev_run_one(payload: tuple[ExecutionContext, dict, tuple[str, ...], str, str, str, dict]) -> None:
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


def _cmd_dev_run(args: argparse.Namespace) -> int:
    """Prefetch GRIBs and fan out workers locally."""
    cfg = PipelineConfig.from_uri(args.pipeline_config_uri)
    ctx = cfg.to_execution_context(args.artifact_root_uri)

    cycle = args.cycle
    _, cycle_hour = parse_cycle(args.cycle)
    base_url, vars_levels = cfg.nomads.base_url, cfg.nomads.vars_levels

    etl_dir = default_etl_dir()
    fhours = cfg.workload.forecast_hours
    scalar_variables = tuple(cfg.workload.variables or ())
    tasks: list[tuple[ExecutionContext, dict, tuple[str, ...], str, str, str, dict]] = []

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

    procs = int(args.procs)
    with Pool(processes=None if procs <= 0 else procs) as pool:
        for _ in pool.imap_unordered(_dev_run_one, tasks):
            pass

    return 0


def main(argv: list[str] | None = None) -> int:
    ap = build_arg_parser()
    args = ap.parse_args(argv)
    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
