"""URI and local checkout helpers shared by ETL producers and artifact consumers."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse, urlunparse


def default_etl_dir() -> Path:
    """Root directory for ETL config/cache defaults."""
    env_value = os.environ.get("FORECAST_ETL_DIR")
    if env_value is not None and env_value.strip():
        return Path(env_value).expanduser().resolve()
    return Path(__file__).resolve().parents[1]


def default_repo_dir() -> Path:
    """Root directory for the weather-map checkout."""
    return default_etl_dir().parent


def file_uri(p: Path) -> str:
    """Absolute file:// URI for a local path."""
    return f"file://{p.resolve().as_posix()}"


def default_artifact_root_uri() -> str:
    """Default local artifact root used when CLI/env does not provide one."""
    return file_uri(default_repo_dir() / "artifacts")


def default_pipeline_config_uri() -> str:
    """Default pipeline config URI used when CLI/env does not provide one."""
    return file_uri(default_etl_dir() / "forecast.etl_config.json")


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

    if p.netloc in ("", "localhost"):
        return Path(p.path)

    return Path(p.netloc) / p.path.lstrip("/")
