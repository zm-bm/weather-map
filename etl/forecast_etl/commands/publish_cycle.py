"""Publish command for one processed forecast cycle."""

from __future__ import annotations

from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ModelConfig
from ..manifest.publish import run_publish
from ..runtime import ExecutionContext
from ..storage.base import UriStore
from ..storage.routing import make_store


def publish_cycle(*, ctx: ExecutionContext, model: ModelConfig, cycle: str, store: UriStore | None = None) -> None:
    """Publish the manifest for a processed model cycle."""

    resolved_store = store if store is not None else make_store()
    artifact_repo = ArtifactRepository.for_root(store=resolved_store, artifact_root_uri=ctx.artifact_root_uri)
    run_publish(
        ctx=ctx,
        cycle=cycle,
        model_label=model.label,
        artifact_ids=model.workload.artifacts,
        artifact_specs=model.artifacts,
        artifact_repo=artifact_repo,
    )
