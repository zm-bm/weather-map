"""ETL pipeline configuration types.

This module intentionally defines *naming-level* configuration only:
- artifact root URI (file:// or s3://)
- forecast hours list
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Mapping

from .stores import make_store

ALLOWED_SCALAR_SOURCE_TRANSFORMS = {"identity"}
REQUIRED_SCALAR_VARIABLE_FIELDS = {
    "parameter",
    "level",
    "grib_match",
    "units",
    "scale_min",
    "scale_max",
    "scalar_encoding",
}


@dataclass(frozen=True)
class ExecutionContext:
    """Per-invocation execution settings.

    This is derived from `PipelineConfig` plus CLI/runtime inputs (e.g.
    `artifact_root_uri`).
    """

    artifact_root_uri: str
    forecast_hours: tuple[str, ...]


@dataclass(frozen=True)
class WorkloadConfig:
    """Hourly forecasts and scalar variables to process."""

    forecast_hours: tuple[str, ...]
    variables: tuple[str, ...]

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
    nomads: NomadsConfig
    scalar_variables: dict[str, dict[str, Any]]
    vector_variables: dict[str, dict[str, Any]]

    @staticmethod
    def from_obj(obj: Mapping[str, Any]) -> "PipelineConfig":
        if not isinstance(obj, dict):
            raise SystemExit("pipeline_config must be a JSON object")

        workload = WorkloadConfig.from_obj(obj.get("workload"))
        nomads = NomadsConfig.from_obj(obj.get("nomads"))

        scalar_variables_obj = obj.get("scalar_variables")
        if not isinstance(scalar_variables_obj, dict):
            raise SystemExit("pipeline_config missing valid 'scalar_variables' object")
        for layer_key, layer_cfg in scalar_variables_obj.items():
            if not isinstance(layer_cfg, Mapping):
                raise SystemExit(f"pipeline_config layer {layer_key!r} must be an object")
            _validate_scalar_variable_config(layer_key=str(layer_key), layer_cfg=layer_cfg)

        vector_variables_obj = obj.get("vector_variables", {})
        if not isinstance(vector_variables_obj, dict):
            raise SystemExit("pipeline_config field 'vector_variables' must be an object when provided")

        return PipelineConfig(
            workload=workload,
            nomads=nomads,
            scalar_variables=scalar_variables_obj,
            vector_variables=vector_variables_obj,
        )

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
        )


def _validate_scalar_variable_config(*, layer_key: str, layer_cfg: Mapping[str, Any]) -> None:
    missing_fields = sorted(field for field in REQUIRED_SCALAR_VARIABLE_FIELDS if field not in layer_cfg)
    if missing_fields:
        raise SystemExit(f"Layer {layer_key!r} missing required fields: {missing_fields!r}")

    for str_field in ("parameter", "level", "units"):
        raw = layer_cfg.get(str_field)
        if not isinstance(raw, str) or not raw.strip():
            raise SystemExit(f"Layer {layer_key!r} field {str_field!r} must be a non-empty string")

    grib_match = layer_cfg.get("grib_match")
    if not isinstance(grib_match, Mapping) or not grib_match:
        raise SystemExit(f"Layer {layer_key!r} field 'grib_match' must be a non-empty object")
    for k, v in grib_match.items():
        if not isinstance(k, str) or not k.strip() or not isinstance(v, str) or not v.strip():
            raise SystemExit(
                f"Layer {layer_key!r} field 'grib_match' must map non-empty strings to non-empty strings"
            )

    scale_min = layer_cfg.get("scale_min")
    scale_max = layer_cfg.get("scale_max")
    if not isinstance(scale_min, (int, float)) or not math.isfinite(float(scale_min)):
        raise SystemExit(f"Layer {layer_key!r} field 'scale_min' must be a finite number")
    if not isinstance(scale_max, (int, float)) or not math.isfinite(float(scale_max)):
        raise SystemExit(f"Layer {layer_key!r} field 'scale_max' must be a finite number")
    if float(scale_min) >= float(scale_max):
        raise SystemExit(
            f"Layer {layer_key!r} requires scale_min < scale_max, got {scale_min!r} >= {scale_max!r}"
        )

    _validate_scalar_encoding(layer_key=layer_key, layer_cfg=layer_cfg)


def _validate_scalar_encoding(*, layer_key: str, layer_cfg: Mapping[str, Any]) -> None:
    scalar = layer_cfg.get("scalar_encoding")
    if not isinstance(scalar, Mapping):
        raise SystemExit(f"Layer {layer_key!r} missing required object field 'scalar_encoding'")

    required = ("encoding_id", "scale", "offset", "nodata", "byte_order", "dtype")
    for field in required:
        if field not in scalar:
            raise SystemExit(f"Layer {layer_key!r} scalar_encoding missing required field {field!r}")

    encoding_id = scalar.get("encoding_id")
    if not isinstance(encoding_id, str) or not encoding_id.strip():
        raise SystemExit(f"Layer {layer_key!r} scalar_encoding.encoding_id must be a non-empty string")

    dtype = scalar.get("dtype")
    if dtype != "int16":
        raise SystemExit(
            f"Layer {layer_key!r} scalar_encoding.dtype must be 'int16', got: {dtype!r}"
        )

    byte_order = scalar.get("byte_order")
    if byte_order not in {"little", "big"}:
        raise SystemExit(
            f"Layer {layer_key!r} scalar_encoding.byte_order must be 'little' or 'big', got: {byte_order!r}"
        )

    scale = scalar.get("scale")
    if not isinstance(scale, (int, float)) or not math.isfinite(float(scale)) or float(scale) == 0:
        raise SystemExit(f"Layer {layer_key!r} scalar_encoding.scale must be a finite non-zero number")

    offset = scalar.get("offset")
    if not isinstance(offset, (int, float)) or not math.isfinite(float(offset)):
        raise SystemExit(f"Layer {layer_key!r} scalar_encoding.offset must be a finite number")

    nodata = scalar.get("nodata")
    if not isinstance(nodata, int) or nodata < -32768 or nodata > 32767:
        raise SystemExit(
            f"Layer {layer_key!r} scalar_encoding.nodata must be an int16 integer (-32768..32767)"
        )

    source_transform = layer_cfg.get("scalar_source_transform", "identity")
    if not isinstance(source_transform, str) or source_transform not in ALLOWED_SCALAR_SOURCE_TRANSFORMS:
        raise SystemExit(
            f"Layer {layer_key!r} scalar_source_transform must be one of "
            f"{sorted(ALLOWED_SCALAR_SOURCE_TRANSFORMS)!r}"
        )
