"""CLI construction of workflow application context."""

from __future__ import annotations

import argparse

from ..storage.base import UriStore
from ..storage.routing import make_store
from ..uris import (
    default_artifact_root_uri,
    default_forecast_catalog_uri,
    default_pipeline_config_uri,
)
from ..workflows.context import ApplicationContext


def app_context(args: argparse.Namespace, *, store: UriStore | None = None) -> ApplicationContext:
    return ApplicationContext(
        artifact_root_uri=getattr(args, "artifact_root_uri", None) or default_artifact_root_uri(),
        pipeline_config_uri=getattr(args, "pipeline_config_uri", None) or default_pipeline_config_uri(),
        pipeline_config_overlay_uri=getattr(args, "pipeline_config_overlay_uri", None),
        forecast_catalog_uri=getattr(args, "forecast_catalog_uri", None) or default_forecast_catalog_uri(),
        store=store if store is not None else make_store(),
    )

