"""NOMADS helper utilities.

This module builds filtered GFS GRIB2 URLs for the NOMADS "filter" endpoint and
downloads missing GRIBs into a local cache.

Intended usage:
- GFS dataset source acquisition downloads once per (cycle, frame_id) into etl/cache/grib/gfs
- Artifact execution then consumes the prepared local GRIB source
"""

from __future__ import annotations

import shutil
import urllib.parse
import urllib.request
from pathlib import Path

from ...core.cycles import parse_cycle
from ..http import SOURCE_HTTP_TIMEOUT_SECONDS, source_request
from .layout import grib_name

NOMADS_DOWNLOAD_TIMEOUT_SECONDS = SOURCE_HTTP_TIMEOUT_SECONDS


def nomads_url(*, base_url: str, vars_levels: dict[str, str], cycle: str, frame_id: str) -> str:
    """Build a NOMADS filter endpoint URL for one GFS GRIB file."""

    cycle_date, cycle_hour = parse_cycle(cycle)
    params = {
        "dir": f"/gfs.{cycle_date}/{cycle_hour}/atmos",
        "file": grib_name(cycle_hour=cycle_hour, frame_id=frame_id),
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
    req = source_request(url)

    try:
        with urllib.request.urlopen(req, timeout=NOMADS_DOWNLOAD_TIMEOUT_SECONDS) as resp:
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
