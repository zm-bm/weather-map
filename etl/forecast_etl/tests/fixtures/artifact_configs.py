from __future__ import annotations

from forecast_etl.config.resolved import ArtifactSpec
from forecast_etl.config.validate import parse_artifact_spec


def artifact_spec(artifact_id: str, raw: dict) -> ArtifactSpec:
    return parse_artifact_spec(artifact_id=artifact_id, raw=raw)


def artifact_specs(raw_artifacts: dict[str, dict]) -> dict[str, ArtifactSpec]:
    return {
        artifact_id: artifact_spec(artifact_id, artifact_config)
        for artifact_id, artifact_config in raw_artifacts.items()
    }


def minimal_artifact_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "tmp",
        "level": "surface",
        "units": "C",
        "source_transform": "identity",
        "encoding": {
            "id": "tmp_surface_i16_v1",
            "format": "linear-i16-v1",
            "dtype": "int16",
            "byte_order": "little",
            "scale": 0.01,
            "offset": 0.0,
            "nodata": -32768,
        },
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "GRIB_ELEMENT": "TMP",
                    "GRIB_SHORT_NAME": "2-HTGL",
                },
            }
        ],
    }


def pressure_msl_config(*, grib_match: dict | None = None, grid_transform: dict | None = None) -> dict:
    config = {
        "kind": "scalar",
        "parameter": "prmsl",
        "level": "mean sea level",
        "units": "Pa",
        "source_transform": "identity",
        "encoding": {
            "id": "prmsl_msl_i8_25pa_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 25,
            "offset": 100500,
            "nodata": -128,
        },
        "components": [
            {"id": "value", "grib_match": grib_match or {"ICON_PARAM": "pmsl"}},
        ],
    }
    if grid_transform is not None:
        config["grid_transform"] = grid_transform
    return config


def cloud_cover_config(
    *,
    parameter: str = "low_clouds",
    level: str = "low cloud layer",
    encoding_id: str = "low_clouds_i8_1pct_v1",
    grib_match: dict | None = None,
) -> dict:
    return {
        "kind": "scalar",
        "parameter": parameter,
        "level": level,
        "units": "%",
        "source_transform": "identity",
        "encoding": {
            "id": encoding_id,
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 1,
            "offset": 50,
            "nodata": -128,
        },
        "components": [
            {"id": "value", "grib_match": grib_match or {"GRIB_ELEMENT": "LCDC"}},
        ],
    }


def wind_artifact_config() -> dict:
    return {
        "kind": "vector",
        "parameter": "wind_uv",
        "level": "10m_above_ground",
        "units": "m/s",
        "encoding": {
            "id": "wind10m_uv_vector_i8_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.5,
            "offset": 0.0,
        },
        "components": [
            {"id": "u", "grib_match": {"GRIB_ELEMENT": "UGRD"}},
            {"id": "v", "grib_match": {"GRIB_ELEMENT": "VGRD"}},
        ],
    }


def precip_total_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "precip_total",
        "level": "surface",
        "units": "mm",
        "source_transform": "identity",
        "encoding": {
            "id": "precip_total_surface_i8_1mm_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 1,
            "offset": 127,
            "nodata": -128,
        },
        "components": [
            {"id": "value", "grib_match": {"ICON_PARAM": "tot_prec"}},
        ],
    }


def precip_rate_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "prate",
        "level": "surface",
        "units": "mm/hr",
        "source_transform": "kg_m2_s_to_mm_hr",
        "encoding": {
            "id": "prate_surface_i8_0p15mmhr_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.15,
            "offset": 19.05,
            "nodata": -128,
        },
        "components": [
            {"id": "value"},
        ],
        "temporal": {
            "kind": "average_rate",
            "source_interval_hours": 1,
        },
        "derivation": {
            "type": "icon_tot_prec_delta_rate",
            "first_hour_previous": "zero",
            "inputs": [
                {"id": "total", "grib_match": {"ICON_PARAM": "tot_prec"}},
            ],
        },
    }


def precip_type_config() -> dict:
    return {
        "kind": "vector",
        "parameter": "precip_type",
        "level": "surface",
        "units": "fraction",
        "source_transform": "identity",
        "encoding": {
            "id": "precip_type_surface_i8_frac_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.003937007874015748,
            "offset": 0.5,
            "nodata": -128,
        },
        "components": [
            {"id": "snow_frac"},
            {"id": "mix_frac"},
        ],
        "derivation": {
            "type": "precip_type_overlay_from_gfs",
            "inputs": [
                {
                    "id": "precip_rate",
                    "grib_match": {
                        "GRIB_ELEMENT": "PRATE",
                        "GRIB_SHORT_NAME": "0-SFC",
                        "GRIB_PDS_PDTN": "0",
                    },
                },
                {"id": "frozen_percent", "grib_match": {"GRIB_ELEMENT": "CPOFP", "GRIB_SHORT_NAME": "0-SFC"}},
                {"id": "rain", "grib_match": {"GRIB_ELEMENT": "CRAIN", "GRIB_SHORT_NAME": "0-SFC"}},
                {"id": "freezing_rain", "grib_match": {"GRIB_ELEMENT": "CFRZR", "GRIB_SHORT_NAME": "0-SFC"}},
                {"id": "ice_pellets", "grib_match": {"GRIB_ELEMENT": "CICEP", "GRIB_SHORT_NAME": "0-SFC"}},
                {"id": "snow", "grib_match": {"GRIB_ELEMENT": "CSNOW", "GRIB_SHORT_NAME": "0-SFC"}},
            ],
        },
    }


def icon_precip_type_config() -> dict:
    config = precip_type_config()
    config["temporal"] = {
        "kind": "average_rate",
        "source_interval_hours": 1,
    }
    config["derivation"] = {
        "type": "precip_type_overlay_from_icon_components",
        "first_hour_previous": "zero",
        "inputs": [
            {"id": "rain_gsp", "grib_match": {"ICON_PARAM": "rain_gsp"}},
            {"id": "rain_con", "grib_match": {"ICON_PARAM": "rain_con"}},
            {"id": "snow_gsp", "grib_match": {"ICON_PARAM": "snow_gsp"}},
            {"id": "snow_con", "grib_match": {"ICON_PARAM": "snow_con"}},
        ],
    }
    return config


def thunderstorm_mask_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "thunderstorm",
        "level": "surface",
        "units": "flag",
        "source_transform": "identity",
        "encoding": {
            "id": "thunderstorm_mask_i8_flag_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 1,
            "offset": 0,
            "nodata": -128,
        },
        "components": [
            {"id": "value"},
        ],
        "derivation": {
            "type": "thunderstorm_mask_from_icon_ww",
            "inputs": [
                {"id": "ww", "grib_match": {"ICON_PARAM": "ww"}},
            ],
        },
    }


def reflectivity_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "refc",
        "level": "entire atmosphere",
        "units": "dBZ",
        "source_transform": "identity",
        "encoding": {
            "id": "refc_entire_atmosphere_i8_0p5dbz_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.5,
            "offset": 31.5,
            "nodata": -128,
        },
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "GRIB_ELEMENT": "REFC",
                    "GRIB_SHORT_NAME": "0-EATM",
                },
            }
        ],
    }


def cin_index_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "cin",
        "level": "mixed layer",
        "units": "J/kg",
        "source_transform": "cin_magnitude",
        "encoding": {
            "id": "cin_index_i8_2jkg_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 2,
            "offset": 254,
            "nodata": -128,
        },
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "GRIB_ELEMENT": "CIN",
                    "GRIB_SHORT_NAME": "18000-0-SPDL",
                },
            }
        ],
    }
