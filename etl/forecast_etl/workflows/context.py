"""Shared application context for ETL workflows."""

from __future__ import annotations

from dataclasses import dataclass, field

from ..artifacts.repository import ArtifactRepository
from ..catalog import load_forecast_catalog
from ..config.load import LoadedPipelineConfig, load_pipeline_config, load_pipeline_config_document
from ..config.resolved import DatasetConfig, PipelineConfig
from ..run_metadata import RunSnapshot, json_document_digest, run_metadata_from_env
from ..run_snapshots import (
    LoadedRunSnapshot,
    ensure_or_load_run_snapshot,
    ensure_run_snapshot,
    load_run_snapshot,
    select_run_id_for_cycle,
)
from ..runtime import ExecutionContext, execution_context_for_dataset
from ..storage.base import UriStore
from ..storage.routing import make_store


@dataclass(frozen=True)
class DatasetRuntime:
    """Resolved config and runtime identity for one dataset."""

    loaded_config: LoadedPipelineConfig
    pipeline_config: PipelineConfig
    dataset: DatasetConfig
    execution_context: ExecutionContext


@dataclass(frozen=True)
class ApplicationContext:
    """Common ETL dependencies resolved once by adapters."""

    artifact_root_uri: str
    pipeline_config_uri: str
    forecast_catalog_uri: str
    pipeline_config_overlay_uri: str | None = None
    store: UriStore = field(default_factory=make_store)

    @property
    def artifact_repo(self) -> ArtifactRepository:
        return ArtifactRepository.for_root(store=self.store, artifact_root_uri=self.artifact_root_uri)

    def load_pipeline_config(self) -> PipelineConfig:
        return load_pipeline_config(
            self.pipeline_config_uri,
            overlay_uri=self.pipeline_config_overlay_uri,
            store=self.store,
        )

    def load_pipeline_config_document(self) -> LoadedPipelineConfig:
        return load_pipeline_config_document(
            self.pipeline_config_uri,
            overlay_uri=self.pipeline_config_overlay_uri,
            store=self.store,
        )

    def load_forecast_catalog(self) -> dict:
        return load_forecast_catalog(catalog_uri=self.forecast_catalog_uri, store=self.store)

    def resolve_dataset_runtime(self, dataset_id: str) -> DatasetRuntime:
        loaded = self.load_pipeline_config_document()
        pipeline_config = loaded.config
        dataset = pipeline_config.dataset(dataset_id)
        return DatasetRuntime(
            loaded_config=loaded,
            pipeline_config=pipeline_config,
            dataset=dataset,
            execution_context=execution_context_for_dataset(dataset, self.artifact_root_uri),
        )

    def source_run_snapshot(self, loaded_config: LoadedPipelineConfig) -> RunSnapshot:
        return RunSnapshot(
            metadata=run_metadata_from_env(config_digest=json_document_digest(loaded_config.raw)),
            pipeline_config=loaded_config.raw,
            forecast_catalog=self.load_forecast_catalog(),
        )

    def ensure_run_snapshot(self, *, dataset_id: str, cycle: str, run_id: str) -> LoadedRunSnapshot:
        return ensure_run_snapshot(
            artifact_repo=self.artifact_repo,
            store=self.store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            pipeline_config_uri=self.pipeline_config_uri,
            pipeline_config_overlay_uri=self.pipeline_config_overlay_uri,
            forecast_catalog_uri=self.forecast_catalog_uri,
        )

    def ensure_or_load_run_snapshot(self, *, dataset_id: str, cycle: str, run_id: str) -> LoadedRunSnapshot:
        return ensure_or_load_run_snapshot(
            artifact_repo=self.artifact_repo,
            store=self.store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            pipeline_config_uri=self.pipeline_config_uri,
            pipeline_config_overlay_uri=self.pipeline_config_overlay_uri,
            forecast_catalog_uri=self.forecast_catalog_uri,
        )

    def load_run_snapshot(self, *, dataset_id: str, cycle: str, run_id: str) -> LoadedRunSnapshot:
        return load_run_snapshot(
            artifact_repo=self.artifact_repo,
            store=self.store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )

    def select_run_id_for_cycle(
        self,
        *,
        dataset_id: str,
        cycle: str,
        required_run_id: str | None,
    ) -> tuple[str | None, list[str]]:
        return select_run_id_for_cycle(
            artifact_repo=self.artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            required_run_id=required_run_id,
        )
