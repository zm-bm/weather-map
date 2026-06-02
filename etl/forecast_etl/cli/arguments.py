"""Shared argparse helpers for forecast-etl commands."""

from __future__ import annotations

import argparse
import os

from ..uris import (
    default_artifact_root_uri,
    default_forecast_catalog_uri,
    default_pipeline_config_uri,
)


def config_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument(
        "--pipeline-config-uri",
        dest="pipeline_config_uri",
        default=os.environ.get("PIPELINE_CONFIG_URI") or default_pipeline_config_uri(),
        help="Pipeline config URI (file://, s3://, http(s)://).",
    )
    parser.add_argument(
        "--pipeline-config-overlay-uri",
        dest="pipeline_config_overlay_uri",
        default=os.environ.get("PIPELINE_CONFIG_OVERLAY_URI") or None,
        help="Optional local/dev pipeline config overlay URI.",
    )
    parser.add_argument(
        "--forecast-catalog-uri",
        dest="forecast_catalog_uri",
        default=os.environ.get("FORECAST_CATALOG_URI") or default_forecast_catalog_uri(),
        help="Forecast catalog URI (file://, s3://, http(s)://).",
    )
    return parser


def runtime_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False, parents=[config_parser()])
    parser.add_argument(
        "--artifact-root-uri",
        dest="artifact_root_uri",
        help="Artifact root URI (file://... or s3://...).",
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


def require_dataset_id(args: argparse.Namespace) -> str:
    return require_str(args.dataset_id, env_name="DATASET_ID", cli_flag="--dataset-id")

