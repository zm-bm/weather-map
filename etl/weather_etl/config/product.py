"""Loaded and validated pipeline/catalog product config pair."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from ._json import json_document_digest, read_json_object
from .catalog import CatalogArtifactRequirement, CatalogRequirements, catalog_requirements
from .pipeline import (
    DatasetConfig,
    LoadedPipelineConfig,
    PipelineArtifactSpec,
    PipelineConfig,
    load_pipeline_config_document,
)

if TYPE_CHECKING:
    from ..storage.base import UriStore


@dataclass(frozen=True)
class LoadedProductConfig:
    """Loaded ETL pipeline config plus validated catalog agreement."""

    _loaded_pipeline_config: LoadedPipelineConfig
    catalog: dict[str, Any]
    catalog_requirements: CatalogRequirements

    @property
    def catalog_version(self) -> str:
        """Product catalog version string."""

        return str(self.catalog["catalogVersion"])

    @property
    def pipeline_config(self) -> PipelineConfig:
        """Resolved ETL production config."""

        return self._loaded_pipeline_config.config

    @property
    def raw_pipeline_config(self) -> dict[str, Any]:
        """Raw pipeline config JSON represented by this product config."""

        return self._loaded_pipeline_config.raw

    def dataset(self, dataset_id: str) -> DatasetConfig:
        """Return one resolved dataset config."""

        return self.pipeline_config.dataset(dataset_id)


def load_product_config(
    *,
    pipeline_uri: str,
    catalog_uri: str,
    store: "UriStore | None" = None,
) -> LoadedProductConfig:
    """Read and validate one paired pipeline config and catalog."""

    from ..storage.routing import make_store

    resolved_store = store if store is not None else make_store()
    return build_loaded_product_config(
        loaded_pipeline_config=load_pipeline_config_document(pipeline_uri, store=resolved_store),
        catalog=read_json_object(
            uri=catalog_uri,
            store=resolved_store,
            parse_description="JSON document",
        ),
    )


def build_loaded_product_config(
    *,
    loaded_pipeline_config: LoadedPipelineConfig,
    catalog: Mapping[str, Any],
) -> LoadedProductConfig:
    """Bind a loaded pipeline config to catalog requirements."""

    catalog_obj = dict(catalog)
    requirements = catalog_requirements(catalog_obj)
    _validate_catalog_requirements_against_pipeline(loaded_pipeline_config.config, requirements)
    return LoadedProductConfig(
        _loaded_pipeline_config=loaded_pipeline_config,
        catalog=catalog_obj,
        catalog_requirements=requirements,
    )


def product_config_digest(product_config: LoadedProductConfig) -> str:
    """Return a deterministic digest for the paired pipeline/catalog config."""

    return product_config_document_digest(
        pipeline=product_config.raw_pipeline_config,
        catalog=product_config.catalog,
    )


def product_config_document_digest(*, pipeline: dict[str, Any], catalog: dict[str, Any]) -> str:
    """Return the paired product config digest for raw pipeline/catalog documents."""

    return json_document_digest({
        "pipeline": pipeline,
        "catalog": catalog,
    })


def _validate_catalog_requirements_against_pipeline(
    pipeline_config: PipelineConfig,
    catalog_requirements: CatalogRequirements,
) -> None:
    """Validate parsed catalog requirements against a resolved pipeline config."""

    for requirement in catalog_requirements.all_requirements:
        artifact = pipeline_config.artifact_catalog.get(requirement.artifact_id)
        if artifact is None:
            raise SystemExit(f"Catalog references unknown artifact: {requirement.artifact_id!r}")
        _validate_artifact_components(requirement=requirement, artifact=artifact)

    for layer in catalog_requirements.raster_layers:
        for requirement in layer.required:
            if any(requirement.artifact_id in dataset.workload.artifacts for dataset in pipeline_config.datasets.values()):
                continue
            raise SystemExit(
                "Catalog raster layer references artifact absent from all dataset workloads: "
                f"layer={layer.layer_id!r} artifact={requirement.artifact_id!r}"
            )


def _validate_artifact_components(
    *,
    requirement: CatalogArtifactRequirement,
    artifact: PipelineArtifactSpec,
) -> None:
    if artifact.component_ids != requirement.components:
        raise SystemExit(
            "Catalog artifact components mismatch: "
            f"artifact={requirement.artifact_id!r} catalog={requirement.components!r} "
            f"config={artifact.component_ids!r}"
        )
