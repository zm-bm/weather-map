"""NOMADS helper utilities.

This module builds filtered GFS GRIB2 URLs for the NOMADS "filter" endpoint and
downloads missing GRIBs into a local cache.

Intended usage:
- GFS model source acquisition downloads once per (cycle, fhour) into etl/cache/grib/gfs
- Artifact execution then consumes the prepared local GRIB source
"""

from __future__ import annotations

import shutil
import urllib.parse
import urllib.request
from pathlib import Path

from ..cycles import parse_cycle
from .gfs_layout import grib_name


def nomads_url(*, base_url: str, vars_levels: dict[str, str], cycle: str, fhour: str) -> str:
    """Build a NOMADS filter endpoint URL for one GFS GRIB file."""

    cycle_date, cycle_hour = parse_cycle(cycle)
    params = {
        "dir": f"/gfs.{cycle_date}/{cycle_hour}/atmos",
        "file": grib_name(cycle_hour=cycle_hour, fhour=fhour),
        **vars_levels,
    }
    return f"{base_url}?{urllib.parse.urlencode(params)}"


def download_if_needed(url: str, out_path: Path, *, force: bool = False) -> bool:
    """Download url -> out_path if missing (or force).

    Returns True if a download occurred.
    """

    if out_path.exists() and not force:
        return False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")

    print(f"Downloading {url} -> {out_path}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "weather-map-etl/1.0"})

    try:
        with urllib.request.urlopen(req) as resp:
            status = getattr(resp, "status", 200)
            if int(status) != 200:
                raise SystemExit(f"NOMADS download failed: HTTP {status} for {url}")
            with open(tmp_path, "wb") as f:
                shutil.copyfileobj(resp, f)
        tmp_path.replace(out_path)
        return True
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
