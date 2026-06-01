"""Pipeline config loading and parsing."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Mapping

from ._types import parse_config_model
from .input import ModelConfigInput, PipelineConfigInput
from .resolved import ArtifactCatalogSpec, ModelConfig, PipelineConfig
from .validate import (
    parse_artifact_catalog_spec,
    parse_model_artifact_spec,
    parse_model_source_config,
    parse_workload_config,
    resolve_artifact_spec,
    validate_model_artifacts_for_source,
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
        models={
            model_id: _parse_model_config(
                model_id=model_id,
                raw=model_cfg,
                artifact_catalog=artifact_catalog,
            )
            for model_id, model_cfg in raw.models.items()
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


def _parse_model_config(
    *,
    model_id: str,
    raw: ModelConfigInput,
    artifact_catalog: Mapping[str, ArtifactCatalogSpec],
) -> ModelConfig:
    """Resolve one raw model config against the shared artifact catalog."""

    source = parse_model_source_config(raw.source)
    workload = parse_workload_config(raw.workload)
    validate_workload_artifacts(artifact_ids=workload.artifacts, artifacts=artifact_catalog)

    model_artifacts = {}
    resolved_artifacts = {}
    for artifact_id in workload.artifacts:
        catalog_artifact = artifact_catalog[artifact_id]
        raw_model_artifact = raw.artifacts.get(artifact_id)
        if raw_model_artifact is None:
            raise SystemExit(f"models.{model_id}.artifacts missing artifact {artifact_id!r}")
        model_artifact = parse_model_artifact_spec(
            artifact_id=artifact_id,
            raw=raw_model_artifact,
            catalog_artifact=catalog_artifact,
        )
        model_artifacts[artifact_id] = model_artifact
        resolved_artifacts[artifact_id] = resolve_artifact_spec(
            catalog_artifact=catalog_artifact,
            model_artifact=model_artifact,
        )

    unknown_model_artifacts = sorted(set(raw.artifacts) - set(workload.artifacts))
    if unknown_model_artifacts:
        raise SystemExit(f"models.{model_id}.artifacts contains artifacts not in workload: {unknown_model_artifacts!r}")
    validate_model_artifacts_for_source(
        model_id=model_id,
        source=source,
        model_artifacts=model_artifacts,
    )

    return ModelConfig(
        id=model_id,
        label=raw.label,
        source=source,
        workload=workload,
        model_artifacts=model_artifacts,
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
