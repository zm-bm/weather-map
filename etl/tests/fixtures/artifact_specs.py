from __future__ import annotations

from weather_etl.config.pipeline import ArtifactSpec, parse_pipeline_config
from weather_etl.config.sources import GFS_NOMADS_SOURCE_TYPE, ICON_DWD_SOURCE_TYPE

from tests.fixtures.pipeline import catalog_artifact, dataset_artifact


def artifact_spec(artifact_id: str, raw: dict) -> ArtifactSpec:
    return gfs_artifact_spec(artifact_id, raw)


def artifact_spec_for_dataset(*, dataset_id: str, artifact_id: str, raw: dict) -> ArtifactSpec:
    builder = icon_artifact_spec if dataset_id == "icon" else gfs_artifact_spec
    return builder(artifact_id, raw)


def gfs_artifact_spec(artifact_id: str, raw: dict) -> ArtifactSpec:
    return _artifact_spec_for_source(artifact_id, raw, source=_gfs_source())


def icon_artifact_spec(artifact_id: str, raw: dict) -> ArtifactSpec:
    return _artifact_spec_for_source(artifact_id, raw, source=_icon_source())


def _artifact_spec_for_source(artifact_id: str, raw: dict, *, source: dict) -> ArtifactSpec:
    cfg = {
        "version": 3,
        "artifact_catalog": {
            artifact_id: catalog_artifact(raw),
        },
        "datasets": {
            "fixture": {
                "label": "Fixture",
                "source": source,
                "workload": {
                    "frame_start": 0,
                    "frame_end": 0,
                    "artifacts": [artifact_id],
                },
                "artifacts": {
                    artifact_id: dataset_artifact(raw),
                },
            },
        },
    }
    return parse_pipeline_config(cfg).dataset("fixture").artifacts[artifact_id]


def _gfs_source() -> dict:
    return {
        "type": GFS_NOMADS_SOURCE_TYPE,
        "grid_id": "gfs_0p25_global",
        "base_url": "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl",
        "vars_levels": {"TMP": "2_m_above_ground"},
        "rate_limit_seconds": 0.0,
    }


def _icon_source() -> dict:
    return {
        "type": ICON_DWD_SOURCE_TYPE,
        "grid_id": "icon_global_regridded_0p125",
        "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
        "rate_limit_seconds": 0.0,
    }


def artifact_specs(raw_artifacts: dict[str, dict]) -> dict[str, ArtifactSpec]:
    return {
        artifact_id: artifact_spec(artifact_id, artifact_config)
        for artifact_id, artifact_config in raw_artifacts.items()
    }


def artifact_specs_for_dataset(*, dataset_id: str, raw_artifacts: dict[str, dict]) -> dict[str, ArtifactSpec]:
    return {
        artifact_id: artifact_spec_for_dataset(
            dataset_id=dataset_id,
            artifact_id=artifact_id,
            raw=artifact_config,
        )
        for artifact_id, artifact_config in raw_artifacts.items()
    }
