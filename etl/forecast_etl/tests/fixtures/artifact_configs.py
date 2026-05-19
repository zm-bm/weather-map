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


def precip_type_config(*, derivation_type: str = "precip_type_from_gfs_categories") -> dict:
    if derivation_type == "precip_type_from_gfs_categories":
        inputs = [
            {"id": "rain", "grib_match": {"GRIB_ELEMENT": "CRAIN", "GRIB_SHORT_NAME": "0-SFC"}},
            {"id": "freezing_rain", "grib_match": {"GRIB_ELEMENT": "CFRZR", "GRIB_SHORT_NAME": "0-SFC"}},
            {"id": "ice_pellets", "grib_match": {"GRIB_ELEMENT": "CICEP", "GRIB_SHORT_NAME": "0-SFC"}},
            {"id": "snow", "grib_match": {"GRIB_ELEMENT": "CSNOW", "GRIB_SHORT_NAME": "0-SFC"}},
        ]
    else:
        inputs = [
            {"id": "ww", "grib_match": {"ICON_PARAM": "ww"}},
        ]

    return {
        "kind": "scalar",
        "parameter": "precip_type",
        "level": "surface",
        "units": "code",
        "source_transform": "identity",
        "encoding": {
            "id": "precip_type_surface_i8_code_v1",
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
            "type": derivation_type,
            "inputs": inputs,
        },
    }


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
