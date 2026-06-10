"""URI normalization and local checkout helpers."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse, urlunparse

ARTIFACT_ROOT_SCHEMES = ("file", "s3")
INPUT_RESOURCE_SCHEMES = ("file", "s3", "http", "https")


def default_etl_dir() -> Path:
    """Root directory for ETL cache defaults."""
    env_value = os.environ.get("WEATHER_ETL_DIR")
    if env_value is not None and env_value.strip():
        return Path(env_value).expanduser().resolve()
    return Path(__file__).resolve().parents[2]


def default_repo_dir() -> Path:
    """Root directory for the weather-map checkout."""
    return default_etl_dir().parent


def file_uri(p: Path) -> str:
    """Absolute file:// URI for a local path."""
    return Path(p).expanduser().resolve().as_uri()


def default_artifact_root_uri() -> str:
    """Default local artifact root used when CLI/env does not provide one."""
    return file_uri(default_repo_dir() / "artifacts")


def default_pipeline_uri() -> str:
    """Default pipeline config URI used when CLI/env does not provide one."""
    return file_uri(default_repo_dir() / "config" / "pipeline.json")


def default_catalog_uri() -> str:
    """Default catalog URI used by ETL availability generation."""
    return file_uri(default_repo_dir() / "config" / "catalog.json")


def normalize_resource_uri(value: str | Path, *, allowed_schemes: Iterable[str]) -> str:
    """Normalize a local path or resource URI to the canonical URI contract."""

    raw = str(value).strip()
    if not raw:
        raise SystemExit("Resource URI/path must be non-empty")

    allowed = tuple(allowed_schemes)
    parsed = urlparse(raw)
    if parsed.scheme:
        if parsed.scheme not in allowed:
            raise SystemExit(f"Unsupported URI scheme: {parsed.scheme!r}; allowed schemes: {sorted(allowed)!r}")
        if parsed.scheme == "file":
            return file_uri(path_from_file_uri(raw))
        return raw

    if "file" not in allowed:
        raise SystemExit(f"Local filesystem paths are not allowed here; allowed schemes: {sorted(allowed)!r}")
    return file_uri(Path(raw))


def join_uri(root_uri: str, parts: Iterable[str]) -> str:
    """Join POSIX-ish path components onto a file:// or s3:// URI."""
    root = normalize_resource_uri(root_uri, allowed_schemes=ARTIFACT_ROOT_SCHEMES)
    parsed = urlparse(root)
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
    """Convert a canonical local file URI to a local Path."""

    raw = str(uri).strip()
    if not (raw.startswith("file:///") or raw.startswith("file://localhost/")):
        raise SystemExit(f"Expected canonical local file URI: {uri}")

    p = urlparse(raw)
    if p.scheme != "file":
        raise SystemExit(f"Expected local file URI: {uri}")
    if p.query or p.fragment:
        raise SystemExit(f"File URI must not include query or fragment: {uri}")
    if p.netloc not in ("", "localhost"):
        raise SystemExit(f"File URI authority must be empty or localhost: {uri}")
    if not p.path.startswith("/"):
        raise SystemExit(f"File URI path must be absolute: {uri}")
    return Path(unquote(p.path))
