#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=str(cwd) if cwd else None)


def nomads_url(*, base_url: str, vars_levels: dict[str, str], cycle_date: str, cycle_hour: str, fhr: str) -> str:
    params = {
        "dir": f"/gfs.{cycle_date}/{cycle_hour}/atmos",
        "file": f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhr}",
        **vars_levels,
    }
    return f"{base_url}?{urllib.parse.urlencode(params)}"


def download_if_needed(url: str, out_path: Path, *, force: bool = False) -> None:
    if out_path.exists() and not force:
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")

    print(f"Downloading {url} -> {out_path}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "weather-map-etl/1.0"})

    try:
        with urllib.request.urlopen(req) as resp:
            status = getattr(resp, "status", 200)
            if status != 200:
                raise RuntimeError(f"HTTP {status} for {url}")
            with open(tmp_path, "wb") as f:
                shutil.copyfileobj(resp, f)
        tmp_path.replace(out_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


def docker_available() -> None:
    try:
        run(["docker", "version"], cwd=Path.cwd())
    except Exception as e:
        raise SystemExit("Docker is required to run the ETL worker.") from e


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def load_json_file(path: Path, *, what: str) -> Any:
    if not path.exists():
        raise SystemExit(f"{what} not found: {path}.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise SystemExit(f"Failed to parse {what} JSON {path}: {e}") from e


def load_layer_config(path: Path) -> object:
    return load_json_file(path, what="Layer config")


def load_run_config(path: Path) -> dict[str, Any]:
    obj = load_json_file(path, what="Run config")
    if not isinstance(obj, dict):
        raise SystemExit("run_config.json must be a JSON object.")
    return obj


def validate_run_config(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise SystemExit("run_config.json must be a JSON object.")

    layers = obj.get("layers")
    hours = obj.get("hours")
    min_zoom = obj.get("min_zoom")
    max_zoom = obj.get("max_zoom")

    nomads = obj.get("nomads") if isinstance(obj.get("nomads"), dict) else {}
    base_url = nomads.get("base_url") or obj.get("base_url")
    vars_levels = nomads.get("vars_levels") or obj.get("vars_levels")

    if not isinstance(layers, list) or not all(isinstance(x, str) and x for x in layers):
        raise SystemExit("run_config.json: 'layers' must be a list of strings.")
    if not isinstance(hours, list) or not all(isinstance(x, str) and x.isdigit() and len(x) == 3 for x in hours):
        raise SystemExit("run_config.json: 'hours' must be a list of 'FFF' strings (e.g. '003').")
    if not isinstance(min_zoom, int) or not isinstance(max_zoom, int):
        raise SystemExit("run_config.json: 'min_zoom' and 'max_zoom' must be integers.")
    if not isinstance(base_url, str) or not base_url:
        raise SystemExit("run_config.json: 'nomads.base_url' must be a non-empty string.")
    if not isinstance(vars_levels, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in vars_levels.items()):
        raise SystemExit("run_config.json: 'nomads.vars_levels' must be an object of string->string.")

    return {
        "layers": layers,
        "hours": hours,
        "min_zoom": min_zoom,
        "max_zoom": max_zoom,
        "nomads": {
            "base_url": base_url,
            "vars_levels": vars_levels,
        },
    }


def compute_revision(*, cycle: str, run_config: dict[str, Any], layer_config_obj: object) -> str:
    payload = "|".join(
        [
            cycle,
            json.dumps(run_config, sort_keys=True, separators=(",", ":")),
            json.dumps(layer_config_obj, sort_keys=True, separators=(",", ":")),
        ]
    )
    return sha256_hex(payload)[:12]


def parse_cycle(cycle: str) -> tuple[str, str]:
    if len(cycle) != 10 or not cycle.isdigit():
        raise SystemExit("cycle must be YYYYMMDDHH (10 digits), e.g. 2026011412")
    return cycle[:8], cycle[8:10]


@dataclass(frozen=True)
class RepoPaths:
    repo_root: Path
    etl_dir: Path
    data_dir: Path
    out_dir: Path
    backend_mbtiles: Path
    frontend_manifests: Path


@dataclass(frozen=True)
class JobRef:
    cycle: str
    fhr: str


@dataclass(frozen=True)
class JobContext:
    out_dir: Path
    data_dir: Path
    cycle: str
    fhr: str
    layer: str
    grib_relpath: Path
    min_zoom: int
    max_zoom: int


def repo_paths() -> RepoPaths:
    # Make this work whether invoked from repo_root/scripts or repo_root/etl/src.
    repo_root: Path | None = None
    for p in Path(__file__).resolve().parents:
        if (p / "etl").is_dir() and (p / "backend").exists() and (p / "frontend").exists():
            repo_root = p
            break
    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]

    etl_dir = repo_root / "etl"
    return RepoPaths(
        repo_root=repo_root,
        etl_dir=etl_dir,
        data_dir=etl_dir / "data",
        out_dir=etl_dir / "out",
        backend_mbtiles=repo_root / "backend" / "data" / "mbtiles",
        frontend_manifests=repo_root / "frontend" / "public" / "manifests",
    )


def build_worker_image(*, etl_dir: Path) -> None:
    run(
        [
            "docker",
            "build",
            "-t",
            "gfs-worker:dev",
            "-f",
            str(etl_dir / "worker" / "Dockerfile"),
            str(etl_dir),
        ]
    )


class ExecutionBackend(Protocol):
    """Pluggable execution/publish backend (local docker, cloud batch, etc.)."""

    name: str
    paths: RepoPaths

    def prepare(self, *, skip_build: bool) -> None: ...
    def run_layer(self, *, ctx: JobContext) -> None: ...
    def sync_tiles(self) -> None: ...
    def sync_manifests(self, *, manifests_out: Path) -> None: ...
    def finalize(self, *, sync: bool, manifest: bool, manifests_out: Path | None = None) -> None: ...


class LocalDockerBackend:
    name = "local-docker"

    def __init__(self, *, paths: RepoPaths) -> None:
        self.paths = paths

    def prepare(self, *, skip_build: bool) -> None:
        docker_available()
        if not skip_build:
            build_worker_image(etl_dir=self.paths.etl_dir)

    def run_layer(self, *, ctx: JobContext) -> None:
        run(
            [
                "docker",
                "run",
                "--rm",
                "-v", f"{ctx.out_dir}:/out",
                "-v", f"{ctx.data_dir}:/data",
                "gfs-worker:dev",
                "--input", f"/data/{ctx.grib_relpath.as_posix()}",
                "--out", "/out/tiles",
                "--cycle", ctx.cycle,
                "--layer", ctx.layer,
                "--hour", ctx.fhr,
                "--min-zoom", str(ctx.min_zoom),
                "--max-zoom", str(ctx.max_zoom),
            ]
        )

    def sync_tiles(self) -> None:
        self.paths.backend_mbtiles.mkdir(parents=True, exist_ok=True)
        run(["rsync", "-a", "--delete", f"{self.paths.etl_dir / 'out' / 'tiles'}/", f"{self.paths.backend_mbtiles}/"])

    def sync_manifests(self, *, manifests_out: Path) -> None:
        self.paths.frontend_manifests.mkdir(parents=True, exist_ok=True)
        run(["rsync", "-a", "--delete", f"{manifests_out}/", f"{self.paths.frontend_manifests}/"])

    def finalize(self, *, sync: bool, manifest: bool, manifests_out: Path | None = None) -> None:
        if sync:
            self.sync_tiles()
        if manifest:
            if manifests_out is None:
                raise ValueError("manifests_out is required when manifest=True")
            self.sync_manifests(manifests_out=manifests_out)


class CloudBackend:
    name = "cloud"

    def __init__(self, *, paths: RepoPaths) -> None:
        self.paths = paths

    def prepare(self, *, skip_build: bool) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def run_layer(self, *, ctx: JobContext) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def sync_tiles(self) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def sync_manifests(self, *, manifests_out: Path) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def finalize(self, *, sync: bool, manifest: bool, manifests_out: Path | None = None) -> None:
        raise SystemExit("Cloud backend not implemented yet.")


def make_backend(name: str, *, paths: RepoPaths) -> ExecutionBackend:
    if name == "local-docker":
        return LocalDockerBackend(paths=paths)
    if name == "cloud":
        return CloudBackend(paths=paths)
    raise SystemExit(f"Unknown backend: {name}")


def run_one_hour(*, cycle: str, fhr: str, cfg: dict[str, Any], args: argparse.Namespace, backend: ExecutionBackend) -> None:
    cycle_date, cycle_hour = parse_cycle(cycle)
    paths = repo_paths()
    data_dir = paths.data_dir
    out_dir = paths.out_dir

    cache_dir = data_dir / "grib_cache" / cycle
    cache_dir.mkdir(parents=True, exist_ok=True)

    base_url = cfg["nomads"]["base_url"]
    vars_levels = cfg["nomads"]["vars_levels"]

    url = nomads_url(
        base_url=base_url,
        vars_levels=vars_levels,
        cycle_date=cycle_date,
        cycle_hour=cycle_hour,
        fhr=fhr,
    )
    grib_name = f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhr}"
    grib_path = cache_dir / grib_name

    download_if_needed(url, grib_path, force=bool(args.force_download))

    grib_relpath = Path("grib_cache") / cycle / grib_name
    for layer in cfg["layers"]:
        backend.run_layer(
            ctx=JobContext(
                out_dir=out_dir,
                data_dir=data_dir,
                cycle=cycle,
                fhr=fhr,
                layer=layer,
                grib_relpath=grib_relpath,
                min_zoom=cfg["min_zoom"],
                max_zoom=cfg["max_zoom"],
            )
        )


def write_manifests(*, etl_dir: Path, cycle: str, cfg: dict[str, Any], revision: str) -> Path:
    cycle_date, cycle_hour = parse_cycle(cycle)

    manifests_out = etl_dir / "out" / "manifests"
    manifests_out.mkdir(parents=True, exist_ok=True)

    generated_at = utc_now_iso()
    cycle_manifest = {
        "version": 1,
        "cycle": cycle,
        "cycle_date": cycle_date,
        "cycle_hour": cycle_hour,
        "generated_at": generated_at,
        "revision": revision,
        "forecast_hours": cfg["hours"],
        "layers": cfg["layers"],
        "variables_levels": cfg["nomads"]["vars_levels"],
        "min_zoom": cfg["min_zoom"],
        "max_zoom": cfg["max_zoom"],
    }

    (manifests_out / f"{cycle}.json").write_text(
        json.dumps(cycle_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    latest_manifest = {"cycle": cycle, "generated_at": generated_at, "revision": revision}
    (manifests_out / "latest.json").write_text(
        json.dumps(latest_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    return manifests_out


def load_jobs_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Jobs file not found: {path}")
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit(f"Jobs file is empty: {path}")

    if text.startswith("{"):
        obj = json.loads(text)
        if not isinstance(obj, dict) or "jobs" not in obj:
            raise SystemExit(f"Invalid jobs JSON format: {path}")
        return obj

    jobs: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        jobs.append(json.loads(line))
    return {"jobs": jobs}


def cmd_plan(args: argparse.Namespace) -> int:
    cycle = args.cycle
    cycle_date, cycle_hour = parse_cycle(cycle)

    paths = repo_paths()
    etl_dir = paths.etl_dir

    run_cfg = validate_run_config(load_run_config(Path(args.config)))
    layer_config_obj = load_layer_config(etl_dir / "layer_config.json")
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
        jobs_obj = load_jobs_file(Path(args.jobs_file))
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
        raise SystemExit("Provide either (cycle --hour FFF) or (--jobs-file X --job-index N).")
    return JobRef(cycle=str(args.cycle), fhr=str(args.hour))


def cmd_run_job(args: argparse.Namespace) -> int:
    job = resolve_job_ref(args)
    parse_cycle(job.cycle)

    paths = repo_paths()
    etl_dir = paths.etl_dir

    cfg = validate_run_config(load_run_config(Path(args.config)))
    if job.fhr not in cfg["hours"]:
        print(f"WARNING: hour {job.fhr} not found in config hours; proceeding anyway.", flush=True)

    backend = make_backend(str(args.backend), paths=paths)
    backend.prepare(skip_build=bool(args.skip_build))

    run_one_hour(cycle=job.cycle, fhr=job.fhr, cfg=cfg, args=args, backend=backend)

    layer_config_obj = load_layer_config(etl_dir / "layer_config.json")
    revision = compute_revision(cycle=job.cycle, run_config=cfg, layer_config_obj=layer_config_obj)

    if bool(args.sync):
        backend.sync_tiles()
        print("Synced ETL output -> backend/mbtiles", flush=True)

    if bool(args.manifest):
        manifests_out = write_manifests(
            etl_dir=etl_dir,
            cycle=job.cycle,
            cfg=cfg,
            revision=revision,
        )
        backend.sync_manifests(manifests_out=manifests_out)
        print("Synced ETL manifests -> frontend/public/manifests", flush=True)

    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    paths = repo_paths()
    etl_dir = paths.etl_dir

    ap = argparse.ArgumentParser(
        description="ETL CLI: plan per-hour jobs and run a single (cycle, hour) job for MBTiles generation."
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    ap_plan = sub.add_parser("plan", help="Expand per-hour jobs from run_config.json and write jobs file")
    ap_plan.add_argument("cycle", help="Cycle string like 2026011412 (YYYYMMDDHH)")
    ap_plan.add_argument("--config", default=str(etl_dir / "run_config.json"), help="Path to etl/run_config.json")
    ap_plan.add_argument(
        "--out",
        default=str(etl_dir / "out" / "jobs" / "{cycle}.json"),
        help="Output jobs file path template",
    )
    ap_plan.set_defaults(_handler=cmd_plan)

    ap_run = sub.add_parser("run-job", help="Run exactly one per-hour job (download one GRIB + build layers)")
    ap_run.add_argument("cycle", nargs="?", help="Cycle string like 2026011412 (YYYYMMDDHH)")
    ap_run.add_argument("--hour", dest="hour", help="Forecast hour 'FFF' (e.g. 003)")
    ap_run.add_argument("--jobs-file", help="Jobs file from 'plan'")
    ap_run.add_argument("--job-index", type=int, help="Index into jobs file (for array jobs)")
    ap_run.add_argument("--config", default=str(etl_dir / "run_config.json"), help="Path to etl/run_config.json")
    ap_run.add_argument("--backend", choices=["local-docker", "cloud"], default="local-docker", help="Execution backend")
    ap_run.add_argument("--skip-build", action="store_true", help="Skip docker build step")
    ap_run.add_argument("--force-download", action="store_true", help="Re-download GRIB even if cached")
    ap_run.add_argument("--sync", action=argparse.BooleanOptionalAction, default=False, help="rsync tiles -> backend (default: no)")
    ap_run.add_argument(
        "--manifest", action=argparse.BooleanOptionalAction, default=False, help="write+rsync manifests (default: no)"
    )
    ap_run.set_defaults(_handler=cmd_run_job)

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
