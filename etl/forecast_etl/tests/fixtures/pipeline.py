from __future__ import annotations

from .artifact_configs import minimal_artifact_config


def minimal_pipeline_config() -> dict:
    artifact = minimal_artifact_config()
    return {
        "version": 3,
        "artifact_catalog": {
            "tmp_surface": catalog_artifact(artifact),
        },
        "models": {
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
                    "forecast_hour_start": 0,
                    "forecast_hour_end": 0,
                    "artifacts": ["tmp_surface"],
                },
                "artifacts": {
                    "tmp_surface": model_artifact(artifact),
                },
            },
        },
    }


def add_model_artifact(
    cfg: dict,
    *,
    model_id: str,
    artifact_id: str,
    artifact_config: dict,
) -> None:
    cfg["artifact_catalog"][artifact_id] = catalog_artifact(artifact_config)
    cfg["models"][model_id]["artifacts"][artifact_id] = model_artifact(artifact_config)


def catalog_artifact(artifact_config: dict) -> dict:
    return {
        **{
            key: value
            for key, value in artifact_config.items()
            if key not in {"components", "temporal", "derivation", "grid_transform"}
        },
        "components": [{"id": component["id"]} for component in artifact_config["components"]],
    }


def model_artifact(artifact_config: dict) -> dict:
    model_cfg = {
        "components": [
            _model_artifact_component(component)
            for component in artifact_config["components"]
        ],
    }
    if "temporal" in artifact_config:
        model_cfg["temporal"] = artifact_config["temporal"]
    if "derivation" in artifact_config:
        model_cfg["derivation"] = artifact_config["derivation"]
    if "grid_transform" in artifact_config:
        model_cfg["grid_transform"] = artifact_config["grid_transform"]
    return model_cfg


def _model_artifact_component(component: dict) -> dict:
    model_component = {"id": component["id"]}
    if "grib_match" in component:
        model_component["grib_match"] = component["grib_match"]
    return model_component
