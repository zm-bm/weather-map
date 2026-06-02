"""Aggregate data-manifest refresh decisions."""

from __future__ import annotations

from typing import Any, Mapping

from ..artifacts.repository import ArtifactRepository
from ..config.resolved import PipelineConfig
from .data_manifest import publish_data_manifest
from .inspect import manifest_info_from_obj
from .promotion import latest_pointer_matches_revision


def maybe_publish_data_manifest(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    revision: str,
    latest_promoted: bool,
    pipeline_config: PipelineConfig | None,
    forecast_catalog: Mapping[str, Any] | None,
    generated_at: str,
) -> str | None:
    """Refresh the aggregate data manifest when the promoted latest needs it."""

    if pipeline_config is None:
        return None
    if not should_refresh_data_manifest(
        artifacts=artifacts,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        revision=revision,
        latest_promoted=latest_promoted,
    ):
        return None

    data_manifest_uri = publish_data_manifest(
        pipeline_config=pipeline_config,
        artifact_repo=artifacts,
        catalog=forecast_catalog,
        generated_at=generated_at,
    )
    print(f"Published data manifest: {data_manifest_uri}")
    return data_manifest_uri


def should_refresh_data_manifest(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    revision: str,
    latest_promoted: bool,
) -> bool:
    """Return whether aggregate data-manifest publication should run."""

    if latest_promoted:
        return True
    if not latest_pointer_matches_revision(
        artifacts=artifacts,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        revision=revision,
    ):
        return False
    return not data_manifest_dataset_matches_revision(
        artifacts=artifacts,
        dataset_id=dataset_id,
        revision=revision,
    )


def data_manifest_dataset_matches_revision(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    revision: str,
) -> bool:
    """Return whether the aggregate manifest already embeds a dataset revision."""

    if not artifacts.data_manifest_exists():
        return False
    try:
        data_manifest = artifacts.read_data_manifest()
    except (Exception, SystemExit):
        return False

    datasets = data_manifest.get("datasets") if isinstance(data_manifest, Mapping) else None
    dataset_entry = datasets.get(dataset_id) if isinstance(datasets, Mapping) else None
    latest = dataset_entry.get("latest") if isinstance(dataset_entry, Mapping) else None
    info = manifest_info_from_obj(latest) if isinstance(latest, Mapping) else None
    return info is not None and info.revision == revision
