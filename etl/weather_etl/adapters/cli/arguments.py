"""Shared argparse helpers for weather-etl commands."""

from __future__ import annotations

import argparse
import os

from ...core.frames import format_lead_hour_frame_id
from ...storage.uris import (
    default_artifact_root_uri,
    default_catalog_uri,
    default_pipeline_uri,
)


def runtime_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--pipeline-uri",
        dest="pipeline_uri",
        default=os.environ.get("PIPELINE_URI") or default_pipeline_uri(),
        help="Pipeline config path or URI (local path, file:///..., s3://..., http(s)://...).",
    )
    parser.add_argument(
        "--catalog-uri",
        dest="catalog_uri",
        default=os.environ.get("CATALOG_URI") or default_catalog_uri(),
        help="Catalog path or URI (local path, file:///..., s3://..., http(s)://...).",
    )
    parser.add_argument(
        "--artifact-root-uri",
        dest="artifact_root_uri",
        help="Artifact root path or URI (local path, file:///..., or s3://...).",
        default=os.environ.get("ARTIFACT_ROOT_URI") or default_artifact_root_uri(),
    )
    parser.add_argument(
        "--dataset-id",
        dest="dataset_id",
        default=os.environ.get("DATASET_ID"),
        help="Dataset id (required; also accepts $DATASET_ID).",
    )
    return parser


def add_artifact_filter_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--artifact",
        dest="artifacts",
        action="append",
        default=None,
        help="Artifact id to process; repeat to process multiple artifacts.",
    )


def require_str(
    value: str | None,
    *,
    env_name: str,
    cli_flag: str,
) -> str:
    resolved = value if isinstance(value, str) and value.strip() else os.environ.get(env_name, "")
    if not isinstance(resolved, str) or not resolved.strip():
        raise SystemExit(f"Missing required input: {cli_flag} or ${env_name}")
    return resolved.strip()


def optional_str(value: str | None, *, env_name: str) -> str | None:
    resolved = value if isinstance(value, str) and value.strip() else os.environ.get(env_name, "")
    if not isinstance(resolved, str) or not resolved.strip():
        return None
    return resolved.strip()


def parse_frame_selection(raw: str | None) -> tuple[str, ...] | None:
    """Parse a whitespace/comma separated CLI frame selection."""

    if raw is None or not raw.strip():
        return None
    parts = tuple(part.strip() for part in raw.replace(",", " ").split() if part.strip())
    if not parts:
        raise SystemExit("--frames requires at least one frame id")
    return tuple(_normalize_frame(part, index=index) for index, part in enumerate(parts))


def require_dataset_id(args: argparse.Namespace) -> str:
    return require_str(args.dataset_id, env_name="DATASET_ID", cli_flag="--dataset-id")


def _normalize_frame(raw: str, *, index: int) -> str:
    value = raw.strip()
    if len(value) == 14 and value.isdigit():
        return value
    try:
        return format_lead_hour_frame_id(value)
    except ValueError as exc:
        raise SystemExit(f"--frames[{index}] must be a lead-hour or YYYYMMDDHHMMSS frame id: {exc}") from None
