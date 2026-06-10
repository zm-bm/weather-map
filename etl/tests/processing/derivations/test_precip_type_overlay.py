from __future__ import annotations

import struct

from tests.fixtures.artifact_configs import (
    icon_precip_type_config,
    precip_type_config,
)
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_band, grib_bands
from tests.fixtures.grids import grid_meta_fixture, pack_f32
from tests.fixtures.proc import noop_run
from weather_etl.sources.icon.params import previous_icon_prepared_source_key


def test_gfs_precip_type_derives_soft_overlay_components() -> None:
    with artifact_run_fixture(prefix="weather-map-gfs-precip-type-artifact-") as fx:
        rate = pack_f32(
            [0, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.00001, 0.001, float("nan"), 0.001],
            byte_order="little",
        )
        frozen_percent = pack_f32([0, 0, 0, 0, 0, 0, 70, 100, 100, float("nan"), 100, 0], byte_order="little")
        rain = pack_f32([0, 1, 0, 0, 0, 1, 0, 0, 0, float("nan"), 0, 0], byte_order="little")
        freezing_rain = pack_f32([0, 0, 1, 0, 0, 0, 0, 0, 0, float("nan"), 0, 1], byte_order="little")
        ice_pellets = pack_f32([0, 0, 0, 1, 0, 0, 0, 0, 0, float("nan"), 0, 0], byte_order="little")
        snow = pack_f32([0, 0, 0, 0, 1, 1, 0, 0, 1, float("nan"), 0, 1], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands(
                {"GRIB_ELEMENT": "PRATE", "GRIB_SHORT_NAME": "0-SFC", "GRIB_PDS_PDTN": "0"},
                {"GRIB_ELEMENT": "CPOFP", "GRIB_SHORT_NAME": "0-SFC"},
                {"GRIB_ELEMENT": "CRAIN", "GRIB_SHORT_NAME": "0-SFC"},
                {"GRIB_ELEMENT": "CFRZR", "GRIB_SHORT_NAME": "0-SFC"},
                {"GRIB_ELEMENT": "CICEP", "GRIB_SHORT_NAME": "0-SFC"},
                {"GRIB_ELEMENT": "CSNOW", "GRIB_SHORT_NAME": "0-SFC"},
            ),
            sources=(rate, frozen_percent, rain, freezing_rain, ice_pellets, snow),
            grid=grid_meta_fixture(),
        ) as grib:
            result = fx.run_artifact(
                artifact_id="precip_type_surface",
                artifact_config=precip_type_config(),
                source=fx.single_grib_source(),
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="precip_type_surface", dtype="int8")
        assert payload_bytes == struct.pack(
            "bbbbbbbbbbbbbbbbbbbbbbbb",
            -127,
            -127,
            -127,
            -127,
            127,
            -64,
            0,
            127,
            -127,
            -127,
            -128,
            -127,
            -127,
            -127,
            127,
            127,
            -127,
            64,
            -101,
            -127,
            -127,
            -127,
            -128,
            127,
        )
        assert [call.args[1]["GRIB_ELEMENT"] for call in grib.find_band.call_args_list] == [
            "PRATE",
            "CPOFP",
            "CRAIN",
            "CFRZR",
            "CICEP",
            "CSNOW",
        ]
        assert result["encoding_id"] == "precip_type_surface_i8_frac_v1"
        assert result["components"] == ["snow_frac", "mix_frac"]
        assert result["units"] == "fraction"


def test_icon_precip_type_derives_soft_overlay_components_from_accumulations() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-precip-type-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        source_paths = {
            icon_param: fx.grib_path(f"{icon_param}.regridded.grib2")
            for icon_param in ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
        }
        previous_source_paths = {
            previous_icon_prepared_source_key(icon_param): fx.grib_path(f"{icon_param}.previous.regridded.grib2")
            for icon_param in ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
        }
        previous = [10.0] * 12

        def accumulation_values(deltas: list[float]) -> bytes:
            values = [float("nan") if value != value else previous[index] + value for index, value in enumerate(deltas)]
            return pack_f32(values, byte_order="little")

        current_rain_gsp = accumulation_values([1, 0, 0.5, 0.04, float("nan"), 0.2, 0, 0, 0, 0, 0, 0])
        current_rain_con = accumulation_values([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        current_snow_gsp = accumulation_values([0, 1, 0.5, 0, 0, 0.8, 0, 0, 0, 0, 0, 0])
        current_snow_con = accumulation_values([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        previous_bytes = pack_f32(previous, byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(metadata={"ICON_PARAM": "precip_component"}),
            sources=(
                current_rain_gsp,
                previous_bytes,
                current_rain_con,
                previous_bytes,
                current_snow_gsp,
                previous_bytes,
                current_snow_con,
                previous_bytes,
            ),
            grid=grid_meta_fixture(),
        ):
            result = fx.run_artifact(
                artifact_id="precip_type_surface",
                artifact_config=icon_precip_type_config(),
                source=fx.grib_collection_source(
                    grib_paths={
                        **source_paths,
                        **previous_source_paths,
                    },
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="precip_type_surface", dtype="int8")
        assert payload_bytes == struct.pack(
            "bbbbbbbbbbbbbbbbbbbbbbbb",
            -127,
            127,
            -127,
            -127,
            -128,
            0,
            -127,
            -127,
            -127,
            -127,
            -127,
            -127,
            -127,
            -127,
            127,
            -127,
            -128,
            -127,
            -127,
            -127,
            -127,
            -127,
            -127,
            -127,
        )
        assert result["encoding_id"] == "precip_type_surface_i8_frac_v1"
        assert result["components"] == ["snow_frac", "mix_frac"]
        assert result["units"] == "fraction"
