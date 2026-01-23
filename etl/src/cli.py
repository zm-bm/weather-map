#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from paths import repo_paths
from io_utils import load_json_file, parse_cycle, validate_run_config
from backend import make_backend
from job import JobRef
from revision import compute_revision
import core


def cmd_plan(args: argparse.Namespace) -> int:
    cycle = args.cycle
    cycle_date, cycle_hour = parse_cycle(cycle)

    paths = repo_paths()
    etl_dir = paths.etl_dir

    run_config_obj = load_json_file(Path(args.config), what="Run config")
    layer_config_obj = load_json_file(etl_dir / "layer_config.json", what="Layer config")

    run_cfg = validate_run_config(run_config_obj)
    revision = compute_revision(cycle=cycle, run_config=run_cfg, layer_config_obj=layer_config_obj)

    jobs = []
    for fhr in run_cfg["hours"]:
        jobs.append(
            {
                "cycle": cycle,
                "cycle_date": cycle_date,
                "cycle_hour": cycle_hour,
                "fhr": fhr,
                "revision": revision,
                "min_zoom": run_cfg["min_zoom"],
                "max_zoom": run_cfg["max_zoom"],
                "layers": run_cfg["layers"],
            }
        )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "cycle": cycle,
        "revision": revision,
        "config": {
            "layers": run_cfg["layers"],
            "hours": run_cfg["hours"],
            "min_zoom": run_cfg["min_zoom"],
            "max_zoom": run_cfg["max_zoom"],
            "nomads": run_cfg["nomads"],
        },
        "jobs": jobs,
    }
    out_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(
        f"Planned {len(jobs)} jobs for cycle={cycle} "
        f"(hours={len(run_cfg['hours'])}, layers={len(run_cfg['layers'])}, zoom={run_cfg['min_zoom']}..{run_cfg['max_zoom']})"
    )
    print(f"Wrote: {out_path}")
    return 0


def resolve_job_ref(args: argparse.Namespace) -> JobRef:
    if args.jobs_file:
        jobs_obj = load_json_file(Path(args.jobs_file), what="Jobs file")
        jobs = jobs_obj.get("jobs")
        if not isinstance(jobs, list):
            raise SystemExit("Jobs file missing 'jobs' list.")
        if args.job_index is None:
            raise SystemExit("--job-index is required with --jobs-file.")
        if args.job_index < 0 or args.job_index >= len(jobs):
            raise SystemExit(f"--job-index out of range: {args.job_index} (jobs={len(jobs)})")

        job = jobs[args.job_index]
        cycle = job.get("cycle")
        fhr = job.get("fhr")
        if not isinstance(cycle, str) or not isinstance(fhr, str):
            raise SystemExit("Job entry must include 'cycle' (str) and 'fhr' (str).")
        return JobRef(cycle=cycle, fhr=fhr)

    if not args.cycle or not args.hour:
        raise SystemExit("Provide either (--cycle YYYYMMDDHH --hour FFF) or (--jobs-file X --job-index N).")
    return JobRef(cycle=str(args.cycle), fhr=str(args.hour))


def cmd_run_job(args: argparse.Namespace) -> int:

    job = resolve_job_ref(args)
    parse_cycle(job.cycle)

    paths = repo_paths()
    etl_dir = paths.etl_dir

    plan = core.make_plan(
        cycle=job.cycle,
        config_path=Path(args.config),
        layer_config_path=etl_dir / "layer_config.json",
    )
    if job.fhr not in plan.cfg["hours"]:
        print(f"WARNING: hour {job.fhr} not found in config hours; proceeding anyway.", flush=True)

    backend = make_backend(str(args.backend), paths=paths)
    backend.prepare(skip_build=bool(args.skip_build))

    core.run_hour(
        plan=plan,
        fhr=job.fhr,
        paths=paths,
        backend=backend,
        force_download=bool(args.force_download),
    )

    if bool(args.sync):
        backend.sync_tiles()
        print("Synced ETL output -> backend/mbtiles", flush=True)

    return 0


def cmd_finalize(args: argparse.Namespace) -> int:
    paths = repo_paths()
    etl_dir = paths.etl_dir

    backend = make_backend(str(args.backend), paths=paths)
    backend.prepare(skip_build=bool(args.skip_build))

    plan = core.make_plan(
        cycle=str(args.cycle),
        config_path=Path(args.config),
        layer_config_path=etl_dir / "layer_config.json",
    )
    core.finalize(plan=plan, paths=paths, backend=backend, sync_tiles=bool(args.sync_tiles))
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    paths = repo_paths()
    etl_dir = paths.etl_dir

    ap = argparse.ArgumentParser(
        description="ETL CLI: plan per-hour jobs and run a single (cycle, hour) job for MBTiles generation."
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    ap_plan = sub.add_parser("plan", help="Expand per-hour jobs from run_config.json and write jobs file")
    ap_plan.add_argument("--cycle", required=True, help="Cycle string like 2026011412 (YYYYMMDDHH)")
    ap_plan.add_argument("--config", default=str(etl_dir / "run_config.json"), help="Path to etl/run_config.json")
    ap_plan.add_argument(
        "--out",
        default=str(etl_dir / "out" / "jobs" / "{cycle}.json"),
        help="Output jobs file path template",
    )
    ap_plan.set_defaults(_handler=cmd_plan)

    ap_run = sub.add_parser("run-job", help="Run exactly one per-hour job (download one GRIB + build layers)")
    ap_run.add_argument("--cycle", help="Cycle string like 2026011412 (YYYYMMDDHH)")
    ap_run.add_argument("--hour", dest="hour", help="Forecast hour 'FFF' (e.g. 003)")
    ap_run.add_argument("--jobs-file", help="Jobs file from 'plan'")
    ap_run.add_argument("--job-index", type=int, help="Index into jobs file (for array jobs)")
    ap_run.add_argument("--config", default=str(etl_dir / "run_config.json"), help="Path to etl/run_config.json")
    ap_run.add_argument("--backend", choices=["local-docker", "cloud"], default="local-docker", help="Execution backend")
    ap_run.add_argument("--skip-build", action="store_true", help="Skip docker build step")
    ap_run.add_argument("--force-download", action="store_true", help="Re-download GRIB even if cached")
    ap_run.add_argument("--sync", action=argparse.BooleanOptionalAction, default=False, help="rsync tiles -> backend (default: no)")
    ap_run.set_defaults(_handler=cmd_run_job)

    ap_finalize = sub.add_parser("finalize", help="Write+publish manifests (and optionally sync tiles) for a cycle")
    ap_finalize.add_argument("--cycle", required=True, help="Cycle string like 2026011412 (YYYYMMDDHH)")
    ap_finalize.add_argument("--config", default=str(etl_dir / "run_config.json"), help="Path to etl/run_config.json")
    ap_finalize.add_argument("--backend", choices=["local-docker", "cloud"], default="local-docker", help="Execution backend")
    ap_finalize.add_argument("--skip-build", action="store_true", help="Skip docker build step")
    ap_finalize.add_argument(
        "--sync-tiles",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="sync tiles -> backend (default: yes)",
    )
    ap_finalize.set_defaults(_handler=cmd_finalize)

    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_arg_parser()
    args = ap.parse_args(argv)

    if args.cmd == "plan":
        if isinstance(args.out, str) and "{cycle}" in args.out:
            args.out = args.out.format(cycle=args.cycle)

    return int(args._handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
