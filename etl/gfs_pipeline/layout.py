"""Conventions for the GFS ETL pipeline.

This module centralizes deterministic naming/parsing helpers so other modules
don't need to duplicate:
- cycle parsing (YYYYMMDDHH)
- GRIB filename + local cache path conventions
- file:// URI helpers and safe joining for file:// and s3://
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse, urlunparse


# ---------- Cycle / GRIB naming ----------

def parse_cycle(cycle: str) -> tuple[str, str]:
    """Parse YYYYMMDDHH -> (YYYYMMDD, HH)."""
    if len(cycle) != 10 or not cycle.isdigit():
        raise SystemExit("cycle must be YYYYMMDDHH (10 digits), e.g. 2026011412")
    return cycle[:8], cycle[8:10]


def grib_name(*, cycle_hour: str, fhour: str) -> str:
    """GFS 0.25deg GRIB filename for a cycle hour + forecast hour."""
    return f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhour}"


def grib_cache_path(*, etl_dir: Path, cycle: str, cycle_hour: str, fhour: str) -> Path:
    """Local cache location for a GRIB file."""
    return etl_dir / "data" / "grib_cache" / cycle / grib_name(cycle_hour=cycle_hour, fhour=fhour)


# ---------- Local repo / URIs ----------

def default_etl_dir() -> Path:
    """Root directory for the ETL package checkout (.../weather-map/etl)."""
    return Path(__file__).resolve().parents[1]


def file_uri(p: Path) -> str:
    """Absolute file:// URI for a local path."""
    return f"file://{p.resolve().as_posix()}"


def default_artifact_root_uri() -> str:
    """Default local artifact root (used in dev mode)."""
    return file_uri(default_etl_dir() / "out")


def default_pipeline_config_uri() -> str:
    """Default pipeline config URI (used when CLI/env does not provide one)."""
    return file_uri(default_etl_dir() / "pipeline_config.json")


def join_uri(root_uri: str, parts: Iterable[str]) -> str:
    """Join POSIX-ish path components onto a file:// or s3:// URI."""
    parsed = urlparse(root_uri)
    if parsed.scheme not in {"file", "s3"}:
        raise SystemExit(f"Unsupported URI scheme for join_uri: {parsed.scheme!r}")

    base_path = parsed.path.rstrip("/")
    suffix = "/".join([p.strip("/") for p in parts if p])

    if parsed.scheme == "file":
        new_path = f"{base_path}/{suffix}" if base_path else f"/{suffix}"
    else:
        # s3://bucket/<key>
        joined = f"{base_path}/{suffix}" if base_path else f"/{suffix}"
        new_path = joined if joined.startswith("/") else "/" + joined

    return urlunparse((parsed.scheme, parsed.netloc, new_path, "", "", ""))


def path_from_file_uri(uri: str) -> Path:
    """Convert a file URI to a local Path.

    Accepted:
      - file:///abs/path
      - file:/relative/path
      - file://localhost/abs/path
      - file://relative/path   (interprets netloc as first path segment)
    """
    p = urlparse(uri)
    if p.scheme != "file":
        raise SystemExit(f"Expected file:// URI: {uri}")

    # Common/standard forms:
    # - file:///abs/path  -> netloc=""
    # - file://localhost/abs/path -> netloc="localhost"
    if p.netloc in ("", "localhost"):
        return Path(p.path)

    # Lenient support for shorthand like file://data/grib_cache/...
    # Treat netloc as the first path segment.
    return Path(p.netloc) / p.path.lstrip("/")
