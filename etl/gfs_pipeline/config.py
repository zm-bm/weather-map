"""ETL pipeline configuration types.

This module intentionally defines *naming-level* configuration only:
- artifact root URI (file:// or s3://)
- forecast hours list
- GDAL options (high-level knobs; no actual GDAL calls here)
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Mapping

from .stores import make_store


@dataclass(frozen=True)
class GdalConfig:
    """High-level knobs that influence GDAL execution."""

    min_zoom: int
    max_zoom: int
    tile_format: str
    zoom_level_strategy: str
    overview_resampling: str
    warp_resampling: str

    @staticmethod
    def from_obj(obj: Mapping[str, Any] | None) -> "GdalConfig":
        if not isinstance(obj, dict):
            raise SystemExit("pipeline_config missing valid 'gdal' object")

        return GdalConfig(**obj)


@dataclass(frozen=True)
class ExecutionContext:
    """Per-invocation execution settings.

    This is derived from `PipelineConfig` plus CLI/runtime inputs (e.g.
    `artifact_root_uri`).
    """

    artifact_root_uri: str
    forecast_hours: tuple[str, ...]
    gdal: GdalConfig


@dataclass(frozen=True)
class WorkloadConfig:
    """Hourly forecasts and layers to process."""

    forecast_hours: tuple[str, ...]
    layers: tuple[str, ...]

    @staticmethod
    def from_obj(obj: Mapping[str, Any] | None) -> "WorkloadConfig":
        if not isinstance(obj, dict):
            raise SystemExit("pipeline_config missing valid 'workload' object")

        return WorkloadConfig(**obj)


@dataclass(frozen=True)
class NomadsConfig:
    base_url: str
    vars_levels: dict[str, str]
    rate_limit_seconds: float

    @staticmethod
    def from_obj(obj: Mapping[str, Any] | None) -> "NomadsConfig":
        if not isinstance(obj, dict):
            raise SystemExit("pipeline_config missing valid 'nomads' object")

        return NomadsConfig(**obj)


@dataclass(frozen=True)
class PipelineConfig:
    """Validated view of pipeline_config.json (entire pipeline knobs)."""

    workload: WorkloadConfig
    gdal: GdalConfig
    nomads: NomadsConfig
    layers: dict[str, dict[str, Any]]

    @staticmethod
    def from_obj(obj: Mapping[str, Any]) -> "PipelineConfig":
        if not isinstance(obj, dict):
            raise SystemExit("pipeline_config must be a JSON object")

        workload = WorkloadConfig.from_obj(obj.get("workload"))
        gdal = GdalConfig.from_obj(obj.get("gdal"))
        nomads = NomadsConfig.from_obj(obj.get("nomads"))

        layers_obj = obj.get("layers")
        if not isinstance(layers_obj, dict):
            raise SystemExit("pipeline_config missing valid 'layers' object")

        return PipelineConfig(workload=workload, gdal=gdal, nomads=nomads, layers=layers_obj)

    @staticmethod
    def from_uri(pipeline_config_uri: str) -> "PipelineConfig":
        store = make_store()
        raw = store.read_bytes(uri=pipeline_config_uri)
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception as e:
            raise SystemExit(f"Failed to parse pipeline config {pipeline_config_uri}: {e}") from e

        return PipelineConfig.from_obj(obj)

    def to_execution_context(self, artifact_root_uri: str) -> ExecutionContext:
        return ExecutionContext(
            artifact_root_uri=artifact_root_uri,
            forecast_hours=self.workload.forecast_hours,
            gdal=self.gdal,
        )
