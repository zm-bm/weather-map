"""Dataset public-view publishers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from ...config.product import LoadedProductConfig
from ...core.timestamps import utc_now_iso
from ..artifacts.repository import ArtifactRepository
from .index import publish_index, read_index_latest_revision
from .rolling_observed import publish_rolling_observed_latest
from .schema import CycleManifest

_LatestManifestState = Literal["promoted", "already_latest", "newer_latest"]


@dataclass(frozen=True)
class DatasetViewPublishResult:
    """Outcome of refreshing a dataset-facing public view."""

    ready: bool
    published: bool
    message: str | None = None
    errors: tuple[str, ...] = ()


def publish_dataset_view(
    *,
    product_config: LoadedProductConfig,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str | None = None,
    run_id: str | None = None,
    now: datetime | None = None,
) -> DatasetViewPublishResult:
    """Refresh the public view for a dataset according to its configured mode."""

    dataset = product_config.dataset(dataset_id)
    if dataset.mode == "forecast_cycle":
        if cycle is None or run_id is None:
            raise SystemExit("forecast_cycle public view requires cycle and run_id")
        return _publish_direct_latest_view(
            product_config=product_config,
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )

    rolling_result = publish_rolling_observed_latest(
        product_config=product_config,
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        now=now,
    )
    return DatasetViewPublishResult(
        ready=rolling_result.ready,
        published=rolling_result.published,
        message=rolling_result.message,
        errors=() if rolling_result.ready else (rolling_result.message or "rolling observed latest manifest was not ready",),
    )


def _publish_direct_latest_view(
    *,
    product_config: LoadedProductConfig,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> DatasetViewPublishResult:
    manifest = artifact_repo.read_run_manifest(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    artifact_repo.write_cycle_current_manifest(dataset_id=dataset_id, cycle=manifest.cycle, manifest=manifest)
    latest_state = _promote_latest_if_current(artifact_repo=artifact_repo, dataset_id=dataset_id, manifest=manifest)
    index_uri = _publish_index_if_needed(
        product_config=product_config,
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
        manifest=manifest,
        latest_state=latest_state,
    )

    return DatasetViewPublishResult(
        ready=True,
        published=latest_state == "promoted" or index_uri is not None,
        message="Current latest manifest is newer; skipping latest promotion." if latest_state == "newer_latest" else None,
    )


def _promote_latest_if_current(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    manifest: CycleManifest,
) -> _LatestManifestState:
    try:
        current_latest = artifact_repo.read_latest_manifest(dataset_id=dataset_id)
    except (FileNotFoundError, ValueError, SystemExit):
        current_latest = None

    if current_latest is not None and manifest.cycle < current_latest.cycle:
        print(
            "Skipping latest manifest promotion for older cycle.\n"
            f"  cycle={manifest.cycle}\n"
            f"  current_latest_cycle={current_latest.cycle}"
        )
        return "newer_latest"

    if current_latest is not None and _same_manifest_revision(current_latest, manifest):
        return "already_latest"

    artifact_repo.write_latest_manifest(dataset_id=dataset_id, manifest=manifest)
    return "promoted"


def _same_manifest_revision(left: CycleManifest, right: CycleManifest) -> bool:
    return left.cycle == right.cycle and left.run_id == right.run_id and left.revision == right.revision


def _publish_index_if_needed(
    *,
    product_config: LoadedProductConfig,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    manifest: CycleManifest,
    latest_state: _LatestManifestState,
) -> str | None:
    if latest_state == "newer_latest":
        return None
    if latest_state == "already_latest" and read_index_latest_revision(
        artifact_repo=artifact_repo,
        dataset_id=dataset_id,
    ) == manifest.revision:
        return None

    index_uri = publish_index(
        product_config=product_config,
        artifact_repo=artifact_repo,
        generated_at=utc_now_iso(),
        strict_dataset_ids=(dataset_id,),
    )
    print(f"Published manifest index: {index_uri}")
    return index_uri
