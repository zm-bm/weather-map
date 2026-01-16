#!/usr/bin/env python3

import argparse
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

# Forecast hours to download
HOURS = [
    "000",
    "003",
    "006",
    "009",
    "012",
]

LAYERS = [
    "temp2m",
]

MIN_ZOOM = 0
MAX_ZOOM = 5

# Minimal request for temp2m; expand later for other layers.
# Keys must match NOMADS filter_gfs_0p25.pl parameters.
NOMADS_VARS_LEVELS = {
    "var_TMP": "on",
    "lev_2_m_above_ground": "on",
}


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=str(cwd) if cwd else None)


def nomads_url(*, cycle_date: str, cycle_hour: str, fhr: str) -> str:
    params = {
        "dir": f"/gfs.{cycle_date}/{cycle_hour}/atmos",
        "file": f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhr}",
        **NOMADS_VARS_LEVELS,
    }
    return f"{BASE_URL}?{urllib.parse.urlencode(params)}"


def download_if_needed(url: str, out_path: Path, *, force: bool = False) -> None:
    if out_path.exists() and not force:
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")

    print(f"Downloading {url} -> {out_path}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "weather-map-etl/1.0"})

    try:
        with urllib.request.urlopen(req) as resp:
            # Some Python versions don't expose .status on all handlers; be defensive.
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


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Download filtered GFS GRIBs from NOMADS, build MBTiles via the worker container, and sync into backend/mbtiles."
    )
    ap.add_argument("cycle", help="Cycle string like 2026011412 (YYYYMMDDHH)")
    ap.add_argument("--skip-build", action="store_true", help="Skip docker build step")
    ap.add_argument("--force-download", action="store_true", help="Re-download GRIBs even if cached")

    args = ap.parse_args()

    cycle = args.cycle
    if len(cycle) != 10 or not cycle.isdigit():
        raise SystemExit("cycle must be YYYYMMDDHH (10 digits), e.g. 2026011412")

    cycle_date = cycle[:8]
    cycle_hour = cycle[8:10]

    repo_root = Path(__file__).resolve().parents[1]
    etl_dir = repo_root / "etl"
    data_dir = etl_dir / "data"
    out_dir = etl_dir / "out"

    cache_dir = data_dir / "grib_cache" / cycle
    cache_dir.mkdir(parents=True, exist_ok=True)

    docker_available()

    if not args.skip_build:
        run(["docker", "build", "-t", "gfs-worker:dev", str(etl_dir / "worker")])

    # 1) Download per-hour filtered GRIB
    for fhr in HOURS:
        url = nomads_url(cycle_date=cycle_date, cycle_hour=cycle_hour, fhr=fhr)
        grib_name = f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhr}"
        grib_path = cache_dir / grib_name
        download_if_needed(url, grib_path, force=args.force_download)

        # 2) Run worker for each layer using cached GRIB
        for layer in LAYERS:
            run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "-v",
                    f"{out_dir}:/out",
                    "-v",
                    f"{data_dir}:/data",
                    "gfs-worker:dev",
                    "--input",
                    f"/data/grib_cache/{cycle}/{grib_name}",
                    "--out",
                    "/out/tiles",
                    "--cycle",
                    cycle,
                    "--layer",
                    layer,
                    "--hour",
                    fhr,
                    "--min-zoom",
                    str(MIN_ZOOM),
                    "--max-zoom",
                    str(MAX_ZOOM),
                    "--workdir",
                    "/data/workdir",
                ]
            )

    # 3) Sync output into backend
    backend_mbtiles = repo_root / "backend" / "mbtiles"
    backend_mbtiles.mkdir(parents=True, exist_ok=True)
    run(["rsync", "-a", "--delete", f"{etl_dir / 'out' / 'tiles'}/", f"{backend_mbtiles}/"])

    print("Synced ETL output -> backend/mbtiles", flush=True)


if __name__ == "__main__":
    main()
