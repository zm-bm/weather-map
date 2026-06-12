from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from weather_etl.config.pipeline import LoadedPipelineConfig, PipelineConfig, parse_pipeline_config
from weather_etl.config.product import (
    LoadedProductConfig,
    build_loaded_product_config,
)
from weather_etl.config.sources import GFS_NOMADS_SOURCE_TYPE, ICON_DWD_SOURCE_TYPE, MRMS_AWS_S3_SOURCE_TYPE
from weather_etl.state.runs.metadata import RunMetadata
from weather_etl.state.runs.snapshots import LoadedRunSnapshot

from .artifact_configs import (
    minimal_artifact_config,
    precip_rate_config,
    wind_artifact_config,
)
from .artifacts import DEFAULT_CODE_REVISION, DEFAULT_IMAGE_IDENTITY, DEFAULT_PRODUCT_CONFIG_DIGEST, DEFAULT_RUN_ID
from .catalog import catalog_for_dataset


def catalog_artifact(artifact_config: dict) -> dict:
    return {
        **{
            key: value
            for key, value in artifact_config.items()
            if key not in {"components", "temporal", "derivation", "grid_transform"}
        },
        "components": [{"id": component["id"]} for component in artifact_config["components"]],
    }


def dataset_artifact(artifact_config: dict) -> dict:
    dataset_cfg = {
        "components": [
            _dataset_artifact_component(component)
            for component in artifact_config["components"]
        ],
    }
    if "temporal" in artifact_config:
        dataset_cfg["temporal"] = artifact_config["temporal"]
    if "derivation" in artifact_config:
        dataset_cfg["derivation"] = artifact_config["derivation"]
    if "grid_transform" in artifact_config:
        dataset_cfg["grid_transform"] = artifact_config["grid_transform"]
    return dataset_cfg


def _dataset_artifact_component(component: dict) -> dict:
    dataset_component = {"id": component["id"]}
    if "grib_match" in component:
        dataset_component["grib_match"] = component["grib_match"]
    return dataset_component


def minimal_pipeline_config() -> dict:
    artifact = minimal_artifact_config()
    return {
        "version": 3,
        "artifact_catalog": {
            "tmp_surface": catalog_artifact(artifact),
        },
        "datasets": {
            "gfs": {
                "label": "GFS",
                "source": {
                    "type": "gfs_nomads",
                    "grid_id": "gfs_0p25_global",
                    "base_url": "https://example.test",
                    "vars_levels": {},
                    "rate_limit_seconds": 0.0,
                },
                "workload": {
                    "frame_start": 0,
                    "frame_end": 0,
                },
                "artifacts": {
                    "tmp_surface": dataset_artifact(artifact),
                },
            },
        },
    }


def add_dataset_artifact(
    cfg: dict,
    *,
    dataset_id: str,
    artifact_id: str,
    artifact_config: dict,
) -> None:
    cfg["artifact_catalog"][artifact_id] = catalog_artifact(artifact_config)
    cfg["datasets"][dataset_id]["artifacts"][artifact_id] = dataset_artifact(artifact_config)


def raw_pipeline_config(
    *,
    dataset_ids: tuple[str, ...] = ("gfs",),
    source_types: Mapping[str, str] | None = None,
    frame_start: int = 0,
    frame_end: int = 0,
    artifacts: tuple[str, ...] = ("tmp_surface",),
    workload_artifacts: tuple[str, ...] | None = None,
    artifact_configs: Mapping[str, dict[str, Any]] | None = None,
    rate_limit_seconds: float = 0.0,
) -> dict:
    """Build a raw pipeline config object using the real range-based schema."""

    configs = {artifact_id: copy.deepcopy(config) for artifact_id, config in (artifact_configs or {}).items()}
    cfg: dict[str, Any] = {
        "version": 3,
        "artifact_catalog": {},
        "datasets": {},
    }

    for dataset_id in dataset_ids:
        source_type = (source_types or {}).get(dataset_id, _default_source_type(dataset_id))
        artifact_entries: dict[str, Any] = {}
        for artifact_id in artifacts:
            artifact_config = copy.deepcopy(
                configs.get(artifact_id) or _default_artifact_config(artifact_id=artifact_id, source_type=source_type)
            )
            cfg["artifact_catalog"].setdefault(artifact_id, catalog_artifact(artifact_config))
            artifact_entries[artifact_id] = dataset_artifact(artifact_config)

        workload: dict[str, Any] = {}
        if source_type != MRMS_AWS_S3_SOURCE_TYPE:
            workload.update({
                "frame_start": frame_start,
                "frame_end": frame_end,
            })
        if workload_artifacts is not None:
            workload["artifacts"] = list(workload_artifacts)

        dataset_cfg: dict[str, Any] = {
            "label": dataset_id.upper(),
            "source": _source_config(
                source_type=source_type,
                rate_limit_seconds=rate_limit_seconds,
            ),
            "artifacts": artifact_entries,
        }
        if workload:
            dataset_cfg["workload"] = workload
        if source_type == MRMS_AWS_S3_SOURCE_TYPE:
            dataset_cfg["lifecycle"] = {
                "type": "rolling_observed",
                "display_window_minutes": 120,
                "publish_scan_minutes": 180,
            }
        cfg["datasets"][dataset_id] = dataset_cfg

    return cfg


def pipeline_config(
    *,
    dataset_ids: tuple[str, ...] = ("gfs",),
    source_types: Mapping[str, str] | None = None,
    frame_start: int = 0,
    frame_end: int = 0,
    artifacts: tuple[str, ...] = ("tmp_surface",),
    workload_artifacts: tuple[str, ...] | None = None,
    artifact_configs: Mapping[str, dict[str, Any]] | None = None,
    rate_limit_seconds: float = 0.0,
) -> PipelineConfig:
    raw = raw_pipeline_config(
        dataset_ids=dataset_ids,
        source_types=source_types,
        frame_start=frame_start,
        frame_end=frame_end,
        artifacts=artifacts,
        workload_artifacts=workload_artifacts,
        artifact_configs=artifact_configs,
        rate_limit_seconds=rate_limit_seconds,
    )
    return parse_pipeline_config(raw)


def _build_loaded_pipeline_config(
    *,
    dataset_ids: tuple[str, ...] = ("gfs",),
    source_types: Mapping[str, str] | None = None,
    frame_start: int = 0,
    frame_end: int = 0,
    artifacts: tuple[str, ...] = ("tmp_surface",),
    workload_artifacts: tuple[str, ...] | None = None,
    artifact_configs: Mapping[str, dict[str, Any]] | None = None,
    rate_limit_seconds: float = 0.0,
) -> LoadedPipelineConfig:
    raw = raw_pipeline_config(
        dataset_ids=dataset_ids,
        source_types=source_types,
        frame_start=frame_start,
        frame_end=frame_end,
        artifacts=artifacts,
        workload_artifacts=workload_artifacts,
        artifact_configs=artifact_configs,
        rate_limit_seconds=rate_limit_seconds,
    )
    return LoadedPipelineConfig(raw=raw, config=parse_pipeline_config(raw))


def loaded_product_config(
    *,
    dataset_id: str = "gfs",
    dataset_ids: tuple[str, ...] | None = None,
    source_types: Mapping[str, str] | None = None,
    frame_start: int = 0,
    frame_end: int = 0,
    artifacts: tuple[str, ...] = ("tmp_surface",),
    workload_artifacts: tuple[str, ...] | None = None,
    artifact_configs: Mapping[str, dict[str, Any]] | None = None,
    rate_limit_seconds: float = 0.0,
    loaded_pipeline_config: LoadedPipelineConfig | None = None,
    pipeline_config: PipelineConfig | None = None,
    catalog: dict[str, Any] | None = None,
) -> LoadedProductConfig:
    if loaded_pipeline_config is None:
        if pipeline_config is None:
            loaded_pipeline_config = _build_loaded_pipeline_config(
                dataset_ids=dataset_ids or (dataset_id,),
                source_types=source_types,
                frame_start=frame_start,
                frame_end=frame_end,
                artifacts=artifacts,
                workload_artifacts=workload_artifacts,
                artifact_configs=artifact_configs,
                rate_limit_seconds=rate_limit_seconds,
            )
        else:
            loaded_pipeline_config = LoadedPipelineConfig(
                raw=pipeline_config.model_dump(mode="json"),
                config=pipeline_config,
            )
    return build_loaded_product_config(
        loaded_pipeline_config=loaded_pipeline_config,
        catalog=catalog or catalog_for_dataset(loaded_pipeline_config.config.dataset(dataset_id)),
    )


def loaded_run_snapshot(
    *,
    dataset_id: str = "gfs",
    dataset_ids: tuple[str, ...] | None = None,
    source_types: Mapping[str, str] | None = None,
    frame_start: int = 0,
    frame_end: int = 0,
    artifacts: tuple[str, ...] = ("tmp_surface",),
    artifact_configs: Mapping[str, dict[str, Any]] | None = None,
    rate_limit_seconds: float = 0.0,
    cycle: str = "2026021300",
    run_id: str = DEFAULT_RUN_ID,
    artifact_root_uri: str = "s3://artifacts",
    product_config: LoadedProductConfig | None = None,
    loaded_pipeline_config: LoadedPipelineConfig | None = None,
    pipeline_config: PipelineConfig | None = None,
    catalog: dict[str, Any] | None = None,
) -> LoadedRunSnapshot:
    if product_config is None:
        product_config = loaded_product_config(
            dataset_id=dataset_id,
            dataset_ids=dataset_ids,
            source_types=source_types,
            frame_start=frame_start,
            frame_end=frame_end,
            artifacts=artifacts,
            artifact_configs=artifact_configs,
            rate_limit_seconds=rate_limit_seconds,
            loaded_pipeline_config=loaded_pipeline_config,
            pipeline_config=pipeline_config,
            catalog=catalog,
        )
    return LoadedRunSnapshot(
        run_id=run_id,
        product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        pipeline_uri=f"{artifact_root_uri}/runs/{dataset_id}/{cycle}/{run_id}/config/pipeline.json",
        catalog_uri=f"{artifact_root_uri}/runs/{dataset_id}/{cycle}/{run_id}/config/catalog.json",
        metadata=RunMetadata(
            code_revision=DEFAULT_CODE_REVISION,
            image_identity=DEFAULT_IMAGE_IDENTITY,
            product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        ),
        product_config=product_config,
    )


def _default_source_type(dataset_id: str) -> str:
    return ICON_DWD_SOURCE_TYPE if dataset_id == "icon" else GFS_NOMADS_SOURCE_TYPE


def _source_config(*, source_type: str, rate_limit_seconds: float) -> dict[str, Any]:
    if source_type == GFS_NOMADS_SOURCE_TYPE:
        return {
            "type": GFS_NOMADS_SOURCE_TYPE,
            "grid_id": "gfs_0p25_global",
            "base_url": "https://example.test/filter",
            "vars_levels": {},
            "rate_limit_seconds": rate_limit_seconds,
        }
    if source_type == ICON_DWD_SOURCE_TYPE:
        return {
            "type": ICON_DWD_SOURCE_TYPE,
            "grid_id": "icon_global_regridded_0p125",
            "base_url": "https://example.test/icon",
            "rate_limit_seconds": rate_limit_seconds,
        }
    return {
        "type": source_type,
        "grid_id": "test_grid",
    }


def _default_artifact_config(*, artifact_id: str, source_type: str) -> dict[str, Any]:
    if artifact_id == "wind10m_uv":
        return wind_artifact_config()
    if artifact_id == "prate_surface":
        return precip_rate_config()

    artifact = minimal_artifact_config()
    if artifact_id == "rh_surface":
        artifact["parameter"] = "rh"
        artifact["units"] = "%"
        artifact["encoding"] = {
            **artifact["encoding"],
            "id": "rh_surface_i16_v1",
        }
        artifact["components"][0]["grib_match"] = {
            "GRIB_ELEMENT": "RH",
            "GRIB_SHORT_NAME": "2-HTGL",
        }

    if source_type == ICON_DWD_SOURCE_TYPE:
        artifact["components"][0]["grib_match"] = {"ICON_PARAM": "t_2m"}
    return artifact
