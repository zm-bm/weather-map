"""Shared ETL environment and dependency wiring."""

from __future__ import annotations

from dataclasses import dataclass

from ..config.pipeline import DatasetConfig
from ..config.product import LoadedProductConfig, load_product_config
from ..state.artifacts.repository import ArtifactRepository
from ..state.runs.snapshots import (
    LoadedRunSnapshot,
    ensure_or_load_run_snapshot,
    ensure_run_snapshot,
    load_run_snapshot,
)
from ..storage.base import UriStore
from ..storage.routing import make_store
from ..storage.uris import ARTIFACT_ROOT_SCHEMES, INPUT_RESOURCE_SCHEMES, normalize_resource_uri
from .context import ExecutionContext, execution_context


@dataclass(frozen=True)
class DatasetRuntime:
    """Resolved config and runtime identity for one dataset."""

    product_config: LoadedProductConfig
    dataset: DatasetConfig
    execution_context: ExecutionContext


class EtlEnvironment:
    """Normalized ETL URIs plus storage, repository, config/snapshot loading, and context wiring."""

    def __init__(
        self,
        *,
        artifact_root_uri: str,
        pipeline_uri: str,
        catalog_uri: str,
        store: UriStore | None = None,
    ) -> None:
        self.artifact_root_uri = normalize_resource_uri(artifact_root_uri, allowed_schemes=ARTIFACT_ROOT_SCHEMES)
        self.pipeline_uri = normalize_resource_uri(
            pipeline_uri,
            allowed_schemes=INPUT_RESOURCE_SCHEMES,
        )
        self.catalog_uri = normalize_resource_uri(
            catalog_uri,
            allowed_schemes=INPUT_RESOURCE_SCHEMES,
        )
        self.store = store if store is not None else make_store()
        self.artifact_repo = ArtifactRepository.for_root(store=self.store, artifact_root_uri=self.artifact_root_uri)

    def load_product_config(self) -> LoadedProductConfig:
        """Load paired pipeline/catalog product config."""

        return load_product_config(
            pipeline_uri=self.pipeline_uri,
            catalog_uri=self.catalog_uri,
            store=self.store,
        )

    def resolve_dataset_runtime(self, dataset_id: str) -> DatasetRuntime:
        product_config = self.load_product_config()
        dataset = product_config.dataset(dataset_id)
        return DatasetRuntime(
            product_config=product_config,
            dataset=dataset,
            execution_context=execution_context(
                dataset_id=dataset.id,
                artifact_root_uri=self.artifact_root_uri,
                frames=dataset.workload.frames,
            ),
        )

    def ensure_run_snapshot(self, *, dataset_id: str, cycle: str, run_id: str) -> LoadedRunSnapshot:
        return ensure_run_snapshot(
            artifact_repo=self.artifact_repo,
            store=self.store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            pipeline_uri=self.pipeline_uri,
            catalog_uri=self.catalog_uri,
        )

    def ensure_or_load_run_snapshot(self, *, dataset_id: str, cycle: str, run_id: str) -> LoadedRunSnapshot:
        return ensure_or_load_run_snapshot(
            artifact_repo=self.artifact_repo,
            store=self.store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            pipeline_uri=self.pipeline_uri,
            catalog_uri=self.catalog_uri,
        )

    def load_run_snapshot(self, *, dataset_id: str, cycle: str, run_id: str) -> LoadedRunSnapshot:
        return load_run_snapshot(
            artifact_repo=self.artifact_repo,
            store=self.store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
