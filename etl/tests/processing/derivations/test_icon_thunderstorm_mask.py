from __future__ import annotations

import struct

import pytest
from tests.fixtures.artifact_configs import precip_type_config, thunderstorm_mask_config
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_band
from tests.fixtures.grids import grid_meta_fixture, pack_f32
from tests.fixtures.proc import noop_run


def test_icon_weather_code_derives_thunderstorm_mask() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-thunderstorm-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        weather_code_path = fx.grib_path("ww.regridded.grib2")
        weather_codes = pack_f32([0, 95, 96, 97, 98, 99, 51, float("nan"), 0, 0, 0, 0], byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(metadata={"ICON_PARAM": "ww"}),
            source=weather_codes,
            grid=grid_meta_fixture(),
        ):
            result = fx.run_artifact(
                artifact_id="thunderstorm_mask",
                artifact_config=thunderstorm_mask_config(),
                source=fx.grib_collection_source(
                    grib_paths={"ww": weather_code_path},
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="thunderstorm_mask", dtype="int8")
        assert payload_bytes == struct.pack("bbbbbbbbbbbb", 0, 1, 1, 1, 1, 1, 0, -128, 0, 0, 0, 0)
        assert result["encoding_id"] == "thunderstorm_mask_i8_flag_v1"
        assert result["units"] == "flag"


def test_unsupported_derivation_type_fails_clearly() -> None:
    artifact_config = precip_type_config()
    artifact_config["derivation"]["type"] = "not_supported"

    with artifact_run_fixture(prefix="weather-map-unsupported-derivation-") as fx:
        with fx.patch_grib_processing(grid=grid_meta_fixture()), pytest.raises(SystemExit) as raised:
            fx.run_artifact(
                artifact_id="precip_type_surface",
                artifact_config=artifact_config,
                source=fx.single_grib_source(),
                run=noop_run,
            )

    assert "Unsupported artifact derivation" in str(raised.value)
