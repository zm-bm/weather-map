from __future__ import annotations

import pytest
from weather_etl.config.pipeline import load_pipeline_config_document, parse_pipeline_config
from weather_etl.config.sources import MRMS_AWS_S3_SOURCE_TYPE

from tests.fixtures.artifact_configs import (
    cloud_layers_config,
    gfs_precip_total_config,
    icon_precip_type_config,
    minimal_artifact_config,
    precip_rate_config,
    precip_total_config,
    precip_type_config,
    pressure_msl_config,
    thunderstorm_mask_config,
    wind_artifact_config,
)
from tests.fixtures.paths import repo_root_from
from tests.fixtures.pipeline import (
    add_dataset_artifact,
    catalog_artifact,
    dataset_artifact,
    minimal_pipeline_config,
)


def gfs_dataset_config(cfg: dict) -> dict:
    return cfg["datasets"]["gfs"]


def set_gfs_artifact(cfg: dict, artifact_id: str, artifact_config: dict) -> None:
    cfg["artifact_catalog"][artifact_id] = catalog_artifact(artifact_config)
    gfs_dataset_config(cfg)["workload"]["artifacts"] = [artifact_id]
    gfs_dataset_config(cfg)["artifacts"] = {
        artifact_id: dataset_artifact(artifact_config),
    }


def add_icon_dataset(
    cfg: dict,
    artifact_configs: dict[str, dict],
    *,
    artifact_entries: dict[str, dict] | None = None,
) -> None:
    for artifact_id, artifact_config in artifact_configs.items():
        cfg["artifact_catalog"][artifact_id] = catalog_artifact(artifact_config)
    cfg["datasets"]["icon"] = {
        "label": "ICON",
        "source": {
            "type": "icon_dwd_icosahedral",
            "grid_id": "icon_global_regridded_0p125",
            "base_url": "https://opendata.dwd.de/weather/nwp/icon/grib",
            "rate_limit_seconds": 0.0,
        },
        "workload": {
            "frame_start": 0,
            "frame_end": 0,
            "artifacts": list(artifact_configs),
        },
        "artifacts": artifact_entries
        or {
            artifact_id: dataset_artifact(artifact_config) for artifact_id, artifact_config in artifact_configs.items()
        },
    }


def test_pipeline_config_parses_frame_range() -> None:
    parsed = parse_pipeline_config(minimal_pipeline_config())
    dataset = parsed.dataset("gfs")
    assert dataset.workload.frames == ("000",)
    assert dataset.workload.artifacts == ("tmp_surface",)
    assert "tmp_surface" in dataset.artifacts
    assert dataset.artifacts["tmp_surface"].component_ids == ("value",)
    assert dataset.artifacts["tmp_surface"].kind == "scalar"
    assert dataset.mode == "forecast_cycle"


def test_pipeline_config_parses_current_pipeline_json() -> None:
    repo_root = repo_root_from(__file__)

    parsed = load_pipeline_config_document((repo_root / "config" / "pipeline.json").as_uri()).config

    assert tuple(parsed.datasets) == ("gfs", "icon", "mrms")
    mrms = parsed.dataset("mrms")
    assert mrms.source.type == "mrms_aws_s3"
    assert mrms.source.raw["bucket"] == "noaa-mrms-pds"
    assert mrms.source.raw["prefix"] == "CONUS"
    assert mrms.workload.frames == ()
    assert mrms.mode == "rolling_observed"


def test_pipeline_config_parses_mrms_rolling_observed_policy() -> None:
    cfg = minimal_pipeline_config()
    gfs_dataset_config(cfg)["source"] = {
        "type": MRMS_AWS_S3_SOURCE_TYPE,
        "grid_id": "mrms_conus_0p01",
        "bucket": "noaa-mrms-pds",
        "prefix": "CONUS",
    }
    gfs_dataset_config(cfg)["lifecycle"] = {
        "type": "rolling_observed",
        "display_window_minutes": 120,
        "publish_scan_minutes": 180,
    }
    del gfs_dataset_config(cfg)["workload"]

    dataset = parse_pipeline_config(cfg).dataset("gfs")

    assert dataset.lifecycle is not None
    assert dataset.lifecycle.display_window_minutes == 120
    assert dataset.lifecycle.publish_scan_minutes == 180
    assert dataset.workload.frames == ()
    assert dataset.mode == "rolling_observed"


def test_pipeline_config_rejects_forecast_dataset_without_workload_frames() -> None:
    cfg = minimal_pipeline_config()
    del gfs_dataset_config(cfg)["workload"]

    with pytest.raises(SystemExit, match="forecast_cycle datasets must define workload frames"):
        parse_pipeline_config(cfg)


def test_pipeline_config_rejects_mrms_without_rolling_observed_lifecycle() -> None:
    cfg = minimal_pipeline_config()
    gfs_dataset_config(cfg)["source"] = {
        "type": MRMS_AWS_S3_SOURCE_TYPE,
        "grid_id": "mrms_conus_0p01",
        "bucket": "noaa-mrms-pds",
        "prefix": "CONUS",
    }

    with pytest.raises(SystemExit, match="Unsupported dataset mode"):
        parse_pipeline_config(cfg)


def test_pipeline_config_rejects_forecast_source_with_rolling_observed_lifecycle() -> None:
    cfg = minimal_pipeline_config()
    gfs_dataset_config(cfg)["lifecycle"] = {
        "type": "rolling_observed",
        "display_window_minutes": 120,
        "publish_scan_minutes": 180,
    }

    with pytest.raises(SystemExit, match="Unsupported dataset mode"):
        parse_pipeline_config(cfg)


def test_pipeline_config_rejects_rolling_observed_scan_shorter_than_display_window() -> None:
    cfg = minimal_pipeline_config()
    gfs_dataset_config(cfg)["lifecycle"] = {
        "type": "rolling_observed",
        "display_window_minutes": 120,
        "publish_scan_minutes": 60,
    }

    with pytest.raises(SystemExit, match="publish_scan_minutes"):
        parse_pipeline_config(cfg)


def test_pipeline_config_derives_workload_artifacts_from_dataset_artifact_order() -> None:
    cfg = minimal_pipeline_config()
    add_dataset_artifact(
        cfg,
        dataset_id="gfs",
        artifact_id="rh_surface",
        artifact_config={
            **minimal_artifact_config(),
            "parameter": "rh",
            "units": "%",
        },
    )

    dataset = parse_pipeline_config(cfg).dataset("gfs")

    assert tuple(dataset.artifacts) == ("tmp_surface", "rh_surface")
    assert dataset.workload.artifacts == ("tmp_surface", "rh_surface")


def test_pipeline_config_explicit_workload_subset_keeps_all_artifact_specs() -> None:
    cfg = minimal_pipeline_config()
    add_dataset_artifact(
        cfg,
        dataset_id="gfs",
        artifact_id="rh_surface",
        artifact_config={
            **minimal_artifact_config(),
            "parameter": "rh",
            "units": "%",
        },
    )
    gfs_dataset_config(cfg)["workload"]["artifacts"] = ["rh_surface"]

    dataset = parse_pipeline_config(cfg).dataset("gfs")

    assert tuple(dataset.artifacts) == ("tmp_surface", "rh_surface")
    assert dataset.workload.artifacts == ("rh_surface",)


def test_pipeline_config_rejects_unsupported_source_type() -> None:
    cfg = minimal_pipeline_config()
    gfs_dataset_config(cfg)["source"] = {
        "type": "future_radar",
        "grid_id": "radar_grid",
    }

    with pytest.raises(SystemExit, match="Unsupported dataset source type"):
        parse_pipeline_config(cfg)


def test_pipeline_config_parses_icon_dwd_icosahedral_dataset() -> None:
    cfg = minimal_pipeline_config()
    prate_config = precip_rate_config()
    precip_config = precip_total_config()
    wind_config = wind_artifact_config()
    add_icon_dataset(
        cfg,
        {
            "prate_surface": prate_config,
            "precip_total_surface": precip_config,
            "wind10m_uv": wind_config,
        },
        artifact_entries={
            "prate_surface": dataset_artifact(prate_config),
            "precip_total_surface": dataset_artifact(precip_config),
            "wind10m_uv": {
                "components": [
                    {"id": "u", "grib_match": {"ICON_PARAM": "u_10m"}},
                    {"id": "v", "grib_match": {"ICON_PARAM": "v_10m"}},
                ],
            },
        },
    )

    parsed = parse_pipeline_config(cfg)
    icon = parsed.dataset("icon")

    assert icon.source.type == "icon_dwd_icosahedral"
    assert icon.source.raw["base_url"] == "https://opendata.dwd.de/weather/nwp/icon/grib"
    assert icon.workload.artifacts == ("prate_surface", "precip_total_surface", "wind10m_uv")
    assert icon.artifacts["wind10m_uv"].components[1].grib_match["ICON_PARAM"] == "v_10m"
    icon_prate_temporal = icon.artifacts["prate_surface"].temporal
    assert icon_prate_temporal is not None
    assert icon_prate_temporal.kind == "average_rate"


def test_pipeline_config_parses_dataset_artifact_grid_transform() -> None:
    cfg = minimal_pipeline_config()
    pressure = pressure_msl_config(
        grib_match={"GRIB_ELEMENT": "PRMSL"},
        grid_transform={
            "type": "regular_grid_downsample_2x",
            "grid_id": "icon_global_regridded_0p25",
        },
    )
    set_gfs_artifact(cfg, "prmsl_msl", pressure)

    parsed = parse_pipeline_config(cfg)
    transform = parsed.dataset("gfs").artifacts["prmsl_msl"].grid_transform

    assert transform is not None
    assert transform.type == "regular_grid_downsample_2x"
    assert transform.grid_id == "icon_global_regridded_0p25"


def test_pipeline_config_parses_derivation_inputs_separately_from_output_components() -> None:
    cfg = minimal_pipeline_config()
    artifact_config = precip_type_config()
    set_gfs_artifact(cfg, "precip_type_surface", artifact_config)

    parsed = parse_pipeline_config(cfg)
    artifact = parsed.dataset("gfs").artifacts["precip_type_surface"]

    assert artifact.component_ids == ("snow_frac", "mix_frac")
    assert all(component.grib_match is None for component in artifact.components)
    assert artifact.derivation is not None
    assert [input_item.id for input_item in artifact.derivation.inputs] == [
        "precip_rate",
        "frozen_percent",
        "rain",
        "freezing_rain",
        "ice_pellets",
        "snow",
    ]


def test_pipeline_config_parses_gfs_run_total_precip_derivation() -> None:
    cfg = minimal_pipeline_config()
    artifact_config = gfs_precip_total_config()
    set_gfs_artifact(cfg, "precip_total_surface", artifact_config)

    parsed = parse_pipeline_config(cfg)
    artifact = parsed.dataset("gfs").artifacts["precip_total_surface"]

    assert artifact.component_ids == ("value",)
    assert all(component.grib_match is None for component in artifact.components)
    assert artifact.temporal is not None
    assert artifact.temporal.kind == "accumulation"
    assert artifact.derivation is not None
    assert artifact.derivation.type == "gfs_run_total_precip"
    assert artifact.derivation.inputs[0].grib_match["GRIB_ELEMENT__prefix"] == "APCP"


def test_pipeline_config_parses_icon_weather_code_thunderstorm_artifact() -> None:
    cfg = minimal_pipeline_config()
    add_icon_dataset(cfg, {"thunderstorm_mask": thunderstorm_mask_config()})

    parsed = parse_pipeline_config(cfg)
    icon = parsed.dataset("icon")

    assert icon.artifacts["thunderstorm_mask"].derivation.inputs[0].grib_match["ICON_PARAM"] == "ww"


def test_pipeline_config_parses_icon_precip_type_component_overlay() -> None:
    cfg = minimal_pipeline_config()
    precip_type = icon_precip_type_config()
    add_icon_dataset(cfg, {"precip_type_surface": precip_type})

    parsed = parse_pipeline_config(cfg)
    artifact = parsed.dataset("icon").artifacts["precip_type_surface"]

    assert artifact.component_ids == ("snow_frac", "mix_frac")
    assert artifact.temporal is not None
    assert artifact.temporal.kind == "average_rate"
    assert artifact.derivation is not None
    assert [input_item.grib_match["ICON_PARAM"] for input_item in artifact.derivation.inputs] == [
        "rain_gsp",
        "rain_con",
        "snow_gsp",
        "snow_con",
    ]


def test_pipeline_config_rejects_invalid_frame_range() -> None:
    bad_cfg = minimal_pipeline_config()
    gfs_dataset_config(bad_cfg)["workload"]["frame_start"] = 12
    gfs_dataset_config(bad_cfg)["workload"]["frame_end"] = 6

    with pytest.raises(SystemExit):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_duplicate_workload_artifact() -> None:
    bad_cfg = minimal_pipeline_config()
    gfs_dataset_config(bad_cfg)["workload"]["artifacts"] = ["tmp_surface", "tmp_surface"]

    with pytest.raises(SystemExit):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_unknown_workload_artifact() -> None:
    bad_cfg = minimal_pipeline_config()
    gfs_dataset_config(bad_cfg)["workload"]["artifacts"] = ["missing_surface"]

    with pytest.raises(SystemExit):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_invalid_source_transform() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["source_transform"] = "bogus_transform"

    with pytest.raises(SystemExit):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_direct_artifact_missing_component_selector() -> None:
    bad_cfg = minimal_pipeline_config()
    add_dataset_artifact(
        bad_cfg,
        dataset_id="gfs",
        artifact_id="cloud_layers",
        artifact_config=cloud_layers_config(),
    )
    gfs_dataset_config(bad_cfg)["workload"]["artifacts"] = ["cloud_layers"]
    del gfs_dataset_config(bad_cfg)["artifacts"]["cloud_layers"]["components"][0]["grib_match"]

    with pytest.raises(SystemExit, match="direct artifact component must define grib_match"):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_derived_output_component_selector() -> None:
    bad_cfg = minimal_pipeline_config()
    artifact_config = precip_type_config()
    artifact_config["components"][0]["grib_match"] = {"GRIB_ELEMENT": "SNOW"}
    set_gfs_artifact(bad_cfg, "precip_type_surface", artifact_config)

    with pytest.raises(SystemExit, match="derived output component must not define grib_match"):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_scalar_artifact_without_value_component() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["components"] = [{"id": "u"}, {"id": "v"}]

    with pytest.raises(SystemExit, match="scalar artifacts must define exactly"):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_vector_artifact_with_only_value_component() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["kind"] = "vector"

    with pytest.raises(SystemExit, match="vector artifacts must not define exactly"):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_accepts_precipitation_rate_source_transform() -> None:
    cfg = minimal_pipeline_config()
    cfg["artifact_catalog"]["tmp_surface"]["source_transform"] = "kg_m2_s_to_mm_hr"

    parsed = parse_pipeline_config(cfg)

    assert parsed.dataset("gfs").artifacts["tmp_surface"].source_transform == "kg_m2_s_to_mm_hr"


def test_pipeline_config_accepts_linear_encoding_finite_value_range() -> None:
    cfg = minimal_pipeline_config()
    cfg["artifact_catalog"]["tmp_surface"]["encoding"]["finite_value_range"] = {
        "min": -50,
        "max": 50,
    }

    parsed = parse_pipeline_config(cfg)
    finite_value_range = parsed.dataset("gfs").artifacts["tmp_surface"].encoding.finite_value_range

    assert finite_value_range is not None
    assert finite_value_range.min == -50
    assert finite_value_range.max == 50


@pytest.mark.parametrize("finite_value_range", ({"min": 10, "max": 0}, {"min": 0}, {"min": 0, "max": float("inf")}))
def test_pipeline_config_rejects_invalid_finite_value_range(finite_value_range: dict[str, object]) -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"]["finite_value_range"] = finite_value_range

    with pytest.raises(SystemExit):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_finite_value_range_for_piecewise_encoding() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
        "id": "tmp_surface_i8_temp_c_piecewise_v1",
        "format": "temp-c-piecewise-i8-v1",
        "dtype": "int8",
        "byte_order": "none",
        "nodata": -128,
        "finite_value_range": {"min": -35, "max": 50},
    }

    with pytest.raises(SystemExit) as raised:
        parse_pipeline_config(bad_cfg)

    assert "finite_value_range is not supported" in str(raised.value)


def test_pipeline_config_rejects_finite_value_range_endpoint_that_quantizes_to_nodata() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
        "id": "tmp_surface_i8_test_v1",
        "format": "linear-i8-v1",
        "dtype": "int8",
        "byte_order": "none",
        "scale": 1,
        "offset": 128,
        "nodata": -128,
        "finite_value_range": {"min": 0, "max": 1},
    }

    with pytest.raises(SystemExit) as raised:
        parse_pipeline_config(bad_cfg)

    assert "quantizes to the nodata sentinel" in str(raised.value)


def test_pipeline_config_rejects_finite_value_range_endpoint_between_encoding_buckets() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
        "id": "tmp_surface_i8_test_v1",
        "format": "linear-i8-v1",
        "dtype": "int8",
        "byte_order": "none",
        "scale": 2,
        "offset": 0,
        "nodata": -128,
        "finite_value_range": {"min": 0, "max": 99},
    }

    with pytest.raises(SystemExit) as raised:
        parse_pipeline_config(bad_cfg)

    assert "must be exactly representable" in str(raised.value)


def test_pipeline_config_accepts_temperature_piecewise_encoding_without_scale_offset() -> None:
    cfg = minimal_pipeline_config()
    cfg["artifact_catalog"]["tmp_surface"]["encoding"] = {
        "id": "tmp_surface_i8_temp_c_piecewise_v1",
        "format": "temp-c-piecewise-i8-v1",
        "dtype": "int8",
        "byte_order": "none",
        "nodata": -128,
    }

    parsed = parse_pipeline_config(cfg)

    assert parsed.dataset("gfs").artifacts["tmp_surface"].encoding.format == "temp-c-piecewise-i8-v1"


def test_pipeline_config_rejects_invalid_encoding_format_names() -> None:
    bad_cfg = minimal_pipeline_config()
    bad_cfg["artifact_catalog"]["tmp_surface"]["encoding"]["format"] = "scalar-i16-linear-v1"

    with pytest.raises(SystemExit):
        parse_pipeline_config(bad_cfg)


def test_pipeline_config_rejects_dataset_artifact_missing_component_match() -> None:
    cfg = minimal_pipeline_config()
    add_dataset_artifact(
        cfg,
        dataset_id="gfs",
        artifact_id="cloud_layers",
        artifact_config=cloud_layers_config(),
    )
    gfs_dataset_config(cfg)["workload"]["artifacts"] = ["cloud_layers"]
    gfs_dataset_config(cfg)["artifacts"]["cloud_layers"]["components"].append(
        {"id": "ceiling", "grib_match": {"GRIB_ELEMENT": "CEIL"}}
    )

    with pytest.raises(SystemExit):
        parse_pipeline_config(cfg)
