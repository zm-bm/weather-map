"""CLI construction of the ETL environment."""

from __future__ import annotations

import argparse

from ...environment import EtlEnvironment
from ...storage.base import UriStore
from ...storage.routing import make_store
from ...storage.uris import (
    default_artifact_root_uri,
    default_catalog_uri,
    default_pipeline_uri,
)


def build_environment(args: argparse.Namespace, *, store: UriStore | None = None) -> EtlEnvironment:
    return EtlEnvironment(
        artifact_root_uri=getattr(args, "artifact_root_uri", None) or default_artifact_root_uri(),
        pipeline_uri=getattr(args, "pipeline_uri", None) or default_pipeline_uri(),
        catalog_uri=getattr(args, "catalog_uri", None) or default_catalog_uri(),
        store=store if store is not None else make_store(),
    )
