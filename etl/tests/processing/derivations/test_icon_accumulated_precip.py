from __future__ import annotations

import struct

import pytest
from tests.fixtures.artifact_configs import precip_rate_config
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_band, grib_bands
from tests.fixtures.grids import pack_f32
from tests.fixtures.proc import noop_run
from weather_etl.sources.icon.params import previous_icon_prepared_source_key


def test_precip_rate_derives_icon_rate_from_adjacent_tot_prec_accumulations() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-prate-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        current_path = fx.grib_path("tot_prec.current.regridded.grib2")
        previous_path = fx.grib_path("tot_prec.previous.regridded.grib2")
        current = pack_f32([1.0, 2.08, 0.0, float("nan")], byte_order="little")
        previous = pack_f32([0.0, 0.08, 0.0, 0.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"GRIB_ELEMENT": "TOT_PREC"}, {"GRIB_ELEMENT": "TOT_PREC"}, index=1),
            sources=(current, previous),
        ) as grib:
            result = fx.run_artifact(
                artifact_id="prate_surface",
                artifact_config=precip_rate_config(),
                source=fx.grib_collection_source(
                    grib_paths={
                        "tot_prec": current_path,
                        previous_icon_prepared_source_key("tot_prec"): previous_path,
                    },
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        called_paths = [call.args[0] for call in grib.find_band.call_args_list]
        assert called_paths == [current_path, previous_path]
        payload_bytes = fx.payload_bytes(artifact_id="prate_surface", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -120, -114, -127, -128)
        assert result["encoding_id"] == "prate_surface_i8_0p15mmhr_v1"
        assert result["units"] == "mm/hr"


def test_precip_rate_uses_zero_previous_for_first_icon_hour() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-prate-first-artifact-",
        dataset_id="icon",
        frame_id="001",
        source_uri="icon-dwd://icon/2026041200/001",
    ) as fx:
        current_path = fx.grib_path("tot_prec.current.regridded.grib2")
        current = pack_f32([1.0, 2.0, 0.0, float("nan")], byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(metadata={"GRIB_ELEMENT": "TOT_PREC"}),
            source=current,
        ) as grib:
            fx.run_artifact(
                artifact_id="prate_surface",
                artifact_config=precip_rate_config(),
                source=fx.grib_collection_source(
                    grib_paths={"tot_prec": current_path},
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        grib.find_band.assert_called_once()
        payload_bytes = fx.payload_bytes(artifact_id="prate_surface", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -120, -114, -127, -128)


def test_precip_rate_clamps_small_negative_icon_accumulation_delta() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-prate-clamp-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        current_path = fx.grib_path("tot_prec.current.regridded.grib2")
        previous_path = fx.grib_path("tot_prec.previous.regridded.grib2")
        current = pack_f32([1.0, 1.0, 0.0, 0.0], byte_order="little")
        previous = pack_f32([1.002, 1.0, 0.0, 0.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"GRIB_ELEMENT": "TOT_PREC"}, {"GRIB_ELEMENT": "TOT_PREC"}, index=1),
            sources=(current, previous),
        ):
            fx.run_artifact(
                artifact_id="prate_surface",
                artifact_config=precip_rate_config(),
                source=fx.grib_collection_source(
                    grib_paths={
                        "tot_prec": current_path,
                        previous_icon_prepared_source_key("tot_prec"): previous_path,
                    },
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="prate_surface", dtype="int8")
        assert payload_bytes == struct.pack("bbbb", -127, -127, -127, -127)


def test_precip_rate_rejects_meaningful_negative_icon_accumulation_delta() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-prate-negative-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        current_path = fx.grib_path("tot_prec.current.regridded.grib2")
        previous_path = fx.grib_path("tot_prec.previous.regridded.grib2")
        current = pack_f32([1.0, 1.0, 0.0, 0.0], byte_order="little")
        previous = pack_f32([1.02, 1.0, 0.0, 0.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"GRIB_ELEMENT": "TOT_PREC"}, {"GRIB_ELEMENT": "TOT_PREC"}, index=1),
            sources=(current, previous),
        ):
            with pytest.raises(SystemExit) as raised:
                fx.run_artifact(
                    artifact_id="prate_surface",
                    artifact_config=precip_rate_config(),
                    source=fx.grib_collection_source(
                        grib_paths={
                            "tot_prec": current_path,
                            previous_icon_prepared_source_key("tot_prec"): previous_path,
                        },
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=noop_run,
                )

    assert "Negative accumulation delta" in str(raised.value)


def test_precip_rate_requires_hourly_average_rate_metadata() -> None:
    artifact_config = precip_rate_config()
    artifact_config["temporal"]["source_interval_hours"] = 3

    with artifact_run_fixture(
        prefix="weather-map-icon-prate-temporal-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        with fx.patch_grib_processing(), pytest.raises(SystemExit, match="requires source_interval_hours=1"):
            fx.run_artifact(
                artifact_id="prate_surface",
                artifact_config=artifact_config,
                source=fx.grib_collection_source(
                    grib_paths={"tot_prec": fx.grib_path("tot_prec.current.regridded.grib2")},
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )
