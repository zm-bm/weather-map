"""Pipeline config loading and parsing."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Mapping

from ._types import parse_config_model
from .input import DatasetConfigInput, PipelineConfigInput
from .resolved import ArtifactCatalogSpec, DatasetConfig, PipelineConfig
from .validate import (
    parse_artifact_catalog_spec,
    parse_dataset_artifact_spec,
    parse_dataset_source_config,
    parse_workload_config,
    resolve_artifact_spec,
    validate_dataset_artifacts_for_source,
    validate_workload_artifacts,
)

if TYPE_CHECKING:
    from ..storage.base import UriStore


@dataclass(frozen=True)
class LoadedPipelineConfig:
    """Effective raw config plus parsed resolved config."""

    raw: dict[str, Any]
    config: PipelineConfig


def parse_pipeline_config(obj: Mapping[str, Any]) -> PipelineConfig:
    """Parse raw config JSON into a fully resolved `PipelineConfig`."""

    raw = parse_config_model(PipelineConfigInput, obj)
    artifact_catalog = {
        artifact_id: parse_artifact_catalog_spec(artifact_id=artifact_id, raw=artifact_cfg)
        for artifact_id, artifact_cfg in raw.artifact_catalog.items()
    }

    return PipelineConfig(
        artifact_catalog=artifact_catalog,
        datasets={
            dataset_id: _parse_dataset_config(
                dataset_id=dataset_id,
                raw=dataset_cfg,
                artifact_catalog=artifact_catalog,
            )
            for dataset_id, dataset_cfg in raw.datasets.items()
        },
    )


def merge_pipeline_config_overlay(base: Any, overlay: Any) -> Any:
    """Merge a pipeline config overlay into a base JSON object."""

    if isinstance(base, dict) and isinstance(overlay, dict):
        result = copy.deepcopy(base)
        for key, value in overlay.items():
            result[key] = merge_pipeline_config_overlay(result[key], value) if key in result else copy.deepcopy(value)
        return result
    return copy.deepcopy(overlay)


def _parse_dataset_config(
    *,
    dataset_id: str,
    raw: DatasetConfigInput,
    artifact_catalog: Mapping[str, ArtifactCatalogSpec],
) -> DatasetConfig:
    """Resolve one raw dataset config against the shared artifact catalog."""

    source = parse_dataset_source_config(raw.source)
    workload = parse_workload_config(raw.workload)
    validate_workload_artifacts(artifact_ids=workload.artifacts, artifacts=artifact_catalog)

    dataset_artifacts = {}
    resolved_artifacts = {}
    for artifact_id in workload.artifacts:
        catalog_artifact = artifact_catalog[artifact_id]
        raw_dataset_artifact = raw.artifacts.get(artifact_id)
        if raw_dataset_artifact is None:
            raise SystemExit(f"datasets.{dataset_id}.artifacts missing artifact {artifact_id!r}")
        dataset_artifact = parse_dataset_artifact_spec(
            artifact_id=artifact_id,
            raw=raw_dataset_artifact,
            catalog_artifact=catalog_artifact,
        )
        dataset_artifacts[artifact_id] = dataset_artifact
        resolved_artifacts[artifact_id] = resolve_artifact_spec(
            catalog_artifact=catalog_artifact,
            dataset_artifact=dataset_artifact,
        )

    unknown_dataset_artifacts = sorted(set(raw.artifacts) - set(workload.artifacts))
    if unknown_dataset_artifacts:
        raise SystemExit(
            f"datasets.{dataset_id}.artifacts contains artifacts not in workload: {unknown_dataset_artifacts!r}"
        )
    validate_dataset_artifacts_for_source(
        dataset_id=dataset_id,
        source=source,
        dataset_artifacts=dataset_artifacts,
    )

    return DatasetConfig(
        id=dataset_id,
        label=raw.label,
        source=source,
        workload=workload,
        dataset_artifacts=dataset_artifacts,
        artifacts=resolved_artifacts,
    )


def load_pipeline_config(
    pipeline_config_uri: str,
    *,
    overlay_uri: str | None = None,
    store: "UriStore | None" = None,
) -> PipelineConfig:
    """Read and parse pipeline config JSON from a URI-backed store."""

    return load_pipeline_config_document(
        pipeline_config_uri,
        overlay_uri=overlay_uri,
        store=store,
    ).config


def load_pipeline_config_document(
    pipeline_config_uri: str,
    *,
    overlay_uri: str | None = None,
    store: "UriStore | None" = None,
) -> LoadedPipelineConfig:
    """Read the effective raw pipeline config and parse it."""

    from ..storage.routing import make_store

    resolved_store = store if store is not None else make_store()
    obj = _read_config_json(uri=pipeline_config_uri, store=resolved_store)
    if overlay_uri is not None and overlay_uri.strip():
        obj = merge_pipeline_config_overlay(
            obj,
            _read_config_json(uri=overlay_uri, store=resolved_store),
        )

    return LoadedPipelineConfig(raw=obj, config=parse_pipeline_config(obj))


def _read_config_json(*, uri: str, store: "UriStore") -> dict[str, Any]:
    raw = store.read_bytes(uri=uri)
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise SystemExit(f"Failed to parse pipeline config {uri}: {exc}") from exc
    if not isinstance(obj, dict):
        raise SystemExit(f"Pipeline config {uri} must be a JSON object")
    return obj
