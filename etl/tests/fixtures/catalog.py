from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from weather_etl.config.pipeline import DatasetConfig


def catalog_for_dataset(
    dataset: DatasetConfig,
    *,
    artifact_ids: Iterable[str] | None = None,
    catalog_version: str = "test",
) -> dict[str, Any]:
    """Build a valid catalog for selected resolved dataset artifacts."""

    selected = tuple(artifact_ids or dataset.artifacts)
    return {
        "catalogVersion": catalog_version,
        "rasterLayers": [
            {
                "id": artifact_id,
                "source": {
                    "artifactId": artifact_id,
                    "bands": [{"id": component.id} for component in dataset.artifacts[artifact_id].components],
                },
            }
            for artifact_id in selected
        ],
    }


def catalog_for_artifact_configs(
    artifact_configs: Mapping[str, Mapping[str, Any]],
    *,
    artifact_ids: Iterable[str] | None = None,
    catalog_version: str = "test",
) -> dict[str, Any]:
    """Build a valid catalog for raw artifact fixture configs."""

    selected = tuple(artifact_ids or artifact_configs)
    return {
        "catalogVersion": catalog_version,
        "rasterLayers": [
            {
                "id": artifact_id,
                "source": {
                    "artifactId": artifact_id,
                    "bands": [
                        {"id": component["id"]}
                        for component in artifact_configs[artifact_id]["components"]
                    ],
                },
            }
            for artifact_id in selected
        ],
    }
