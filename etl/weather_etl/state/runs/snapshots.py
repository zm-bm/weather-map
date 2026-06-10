"""Helpers for immutable per-run config/catalog snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ...config.pipeline import DatasetConfig, PipelineConfig
from ...config.product import LoadedProductConfig, load_product_config, product_config_digest
from ...storage.base import UriStore
from ..artifacts.repository import ArtifactRepository
from .ids import validate_run_id
from .metadata import (
    RunMetadata,
    RunSnapshot,
    run_metadata_from_document,
    run_metadata_from_env,
    validate_run_document_identity,
)


@dataclass(frozen=True)
class LoadedRunSnapshot:
    """Resolved run snapshot documents and their canonical run URIs."""

    run_id: str
    product_config_digest: str
    pipeline_uri: str
    catalog_uri: str
    metadata: RunMetadata
    product_config: LoadedProductConfig

    @property
    def pipeline_config(self) -> PipelineConfig:
        """Resolved pipeline config represented by this run snapshot."""

        return self.product_config.pipeline_config

    @property
    def raw_pipeline_config(self) -> dict[str, Any]:
        """Raw pipeline config JSON represented by this run snapshot."""

        return self.product_config.raw_pipeline_config

    def dataset(self, dataset_id: str) -> DatasetConfig:
        """Return one resolved dataset from the run snapshot."""

        return self.product_config.dataset(dataset_id)

    @property
    def catalog(self) -> dict[str, Any]:
        """Loaded catalog represented by this run snapshot."""

        return self.product_config.catalog

    @property
    def run_snapshot(self) -> RunSnapshot:
        """Return the frame-job snapshot represented by the loaded documents."""

        return RunSnapshot(
            metadata=self.metadata,
            pipeline=self.raw_pipeline_config,
            catalog=self.catalog,
        )


def select_run_id_for_cycle(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None,
) -> tuple[str | None, list[str]]:
    """Select the only publishable run id unless an explicit run id is required."""

    if required_run_id is not None:
        return validate_run_id(required_run_id), []

    run_ids = list(artifact_repo.list_run_ids(dataset_id=dataset_id, cycle=cycle))
    if not run_ids:
        return None, [f"no runs found for dataset_id={dataset_id!r} cycle={cycle!r}"]
    if len(run_ids) > 1:
        return None, [f"multiple runs found for dataset_id={dataset_id!r} cycle={cycle!r}: {run_ids!r}"]
    return run_ids[0], []


def ensure_run_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
    pipeline_uri: str,
    catalog_uri: str,
) -> LoadedRunSnapshot:
    """Create or verify one run snapshot from source config/catalog URIs."""

    product_config = load_product_config(
        pipeline_uri=pipeline_uri,
        catalog_uri=catalog_uri,
        store=store,
    )
    product_config.dataset(dataset_id)
    digest = product_config_digest(product_config)
    snapshot = RunSnapshot(
        metadata=run_metadata_from_env(product_config_digest=digest),
        pipeline=product_config.raw_pipeline_config,
        catalog=product_config.catalog,
    )
    artifact_repo.ensure_run_snapshot(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return load_run_snapshot(
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )


def ensure_or_load_run_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
    pipeline_uri: str,
    catalog_uri: str,
) -> LoadedRunSnapshot:
    """Load an existing run snapshot, or create it from source config/catalog.

    If another submitter creates the same run snapshot first, retry by loading
    the now-existing immutable snapshot.
    """

    if _run_metadata_exists(artifact_repo=artifact_repo, dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return load_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )

    try:
        return ensure_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            pipeline_uri=pipeline_uri,
            catalog_uri=catalog_uri,
        )
    except SystemExit:
        if _run_metadata_exists(artifact_repo=artifact_repo, dataset_id=dataset_id, cycle=cycle, run_id=run_id):
            return load_run_snapshot(
                artifact_repo=artifact_repo,
                store=store,
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
            )
        raise


def load_run_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> LoadedRunSnapshot:
    """Load and validate the pinned config/catalog for one existing run."""

    run_id = validate_run_id(run_id)
    run_uri = artifact_repo.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    try:
        run_doc = artifact_repo.read_json_uri(run_uri)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Missing run metadata snapshot: {run_uri}") from exc

    pipeline_uri = artifact_repo.paths.run_pipeline_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    catalog_uri = artifact_repo.paths.run_catalog_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    validate_run_document_identity(run_doc=run_doc, dataset_id=dataset_id, cycle=cycle, run_id=run_id, uri=run_uri)
    product_config = load_product_config(
        pipeline_uri=pipeline_uri,
        catalog_uri=catalog_uri,
        store=store,
    )
    digest = product_config_digest(product_config)
    expected_digest = run_doc.get("product_config_digest")
    if expected_digest != digest:
        raise SystemExit(
            "Run snapshot product config digest mismatch:\n"
            f"  run={run_uri}\n"
            f"  run.json={expected_digest!r}\n"
            f"  config={digest!r}"
        )
    return LoadedRunSnapshot(
        run_id=run_id,
        product_config_digest=digest,
        pipeline_uri=pipeline_uri,
        catalog_uri=catalog_uri,
        metadata=run_metadata_from_document(run_doc=run_doc),
        product_config=product_config,
    )


def _run_metadata_exists(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> bool:
    return artifact_repo.store.exists(uri=artifact_repo.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))
