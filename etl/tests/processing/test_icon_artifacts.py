from __future__ import annotations

import struct

from tests.fixtures.artifact_configs import (
    cloud_layers_config,
    precip_total_config,
    pressure_msl_config,
    wind_artifact_config,
)
from tests.fixtures.artifact_runs import artifact_run_fixture, grib_band, grib_bands
from tests.fixtures.grids import grid_meta_fixture, pack_f32
from tests.fixtures.proc import noop_run


def test_precip_total_scalar_uses_icon_param_grib_path_and_encoding() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-precip-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        grib_path = fx.grib_path("tot_prec.regridded.grib2")
        source = pack_f32([0.0, 1.0, 254.0, float("nan")], byte_order="little")

        with fx.patch_grib_processing(
            band=grib_band(metadata={"GRIB_ELEMENT": "TOT_PREC"}),
            source=source,
        ) as grib:
            result = fx.run_artifact(
                artifact_id="precip_total_surface",
                artifact_config=precip_total_config(),
                source=fx.grib_collection_source(
                    grib_paths={"tot_prec": grib_path},
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        grib.find_band.assert_called_once_with(grib_path, {}, run=noop_run)
        assert grib.extract_band.call_args.kwargs["grib_path"] == grib_path
        payload_bytes = fx.payload_bytes(artifact_id="precip_total_surface", dtype="int8")
        expected_payload = struct.pack("bbbb", -127, -126, 127, -128)
        assert payload_bytes == expected_payload
        assert result["payload_uri"] == (
            f"{fx.artifact_root_uri}/runs/icon/2026041200/{fx.run_id}/payloads/003/precip_total_surface.i8.bin"
        )
        assert result["encoding_id"] == "precip_total_surface_i8_1mm_v1"
        assert result["units"] == "mm"
        assert result["grid_id"] == "icon_global_regridded_0p125"


def test_icon_pressure_can_publish_downsampled_grid() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-pressure-downsample-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        grib_path = fx.grib_path("pmsl.regridded.grib2")
        source = pack_f32([100500.0] * 15, byte_order="little")
        source_grid = {
            **grid_meta_fixture(),
            "nx": 5,
            "ny": 3,
            "lon0": 180.0,
            "dx": 0.125,
            "dy": -0.125,
        }

        with fx.patch_grib_processing(
            band=grib_band(metadata={"GRIB_ELEMENT": "PMSL"}),
            source=source,
            grid=source_grid,
        ):
            result = fx.run_artifact(
                artifact_id="prmsl_msl",
                artifact_config=pressure_msl_config(
                    grid_transform={
                        "type": "regular_grid_downsample_2x",
                        "grid_id": "icon_global_regridded_0p25",
                    }
                ),
                source=fx.grib_collection_source(
                    grib_paths={"pmsl": grib_path},
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

        payload_bytes = fx.payload_bytes(artifact_id="prmsl_msl", dtype="int8")
        assert payload_bytes == b"\x00" * 6
        assert result["byte_length"] == 6
        assert result["grid_id"] == "icon_global_regridded_0p25"
        assert result["grid"]["nx"] == 3
        assert result["grid"]["ny"] == 2
        assert result["grid"]["dx"] == 0.25
        assert result["grid"]["dy"] == -0.25


def test_icon_cloud_layers_use_configured_component_grib_paths() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-cloud-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        paths = {
            "clcl": fx.grib_path("clcl.regridded.grib2"),
            "clcm": fx.grib_path("clcm.regridded.grib2"),
            "clch": fx.grib_path("clch.regridded.grib2"),
        }
        artifact_config = cloud_layers_config(
            grib_matches={
                "low": {"ICON_PARAM": "clcl"},
                "middle": {"ICON_PARAM": "clcm"},
                "high": {"ICON_PARAM": "clch"},
            }
        )
        component_source = pack_f32([0.0, 5.0, 10.0, 15.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"id": "low"}, {"id": "middle"}, {"id": "high"}, index=1),
            sources=(component_source, component_source, component_source),
        ) as grib:
            fx.run_artifact(
                artifact_id="cloud_layers",
                artifact_config=artifact_config,
                source=fx.grib_collection_source(
                    grib_paths=paths,
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

    called_paths = [call.args[0] for call in grib.find_band.call_args_list]
    assert called_paths == [paths["clcl"], paths["clcm"], paths["clch"]]


def test_icon_wind_uses_u_and_v_grib_paths() -> None:
    with artifact_run_fixture(
        prefix="weather-map-icon-wind-artifact-",
        dataset_id="icon",
        source_uri="icon-dwd://icon/2026041200/003",
    ) as fx:
        paths = {
            "u_10m": fx.grib_path("u_10m.regridded.grib2"),
            "v_10m": fx.grib_path("v_10m.regridded.grib2"),
        }

        artifact_config = wind_artifact_config()
        artifact_config["components"][0]["grib_match"] = {"ICON_PARAM": "u_10m"}
        artifact_config["components"][1]["grib_match"] = {"ICON_PARAM": "v_10m"}
        u_src = pack_f32([1.0, 2.0, 3.0, 4.0], byte_order="little")
        v_src = pack_f32([-1.0, -2.0, -3.0, -4.0], byte_order="little")

        with fx.patch_grib_processing(
            bands=grib_bands({"id": "u"}, {"id": "v"}, index=1),
            sources=(u_src, v_src),
        ) as grib:
            fx.run_artifact(
                artifact_id="wind10m_uv",
                artifact_config=artifact_config,
                source=fx.grib_collection_source(
                    grib_paths=paths,
                    grid_id="icon_global_regridded_0p125",
                ),
                run=noop_run,
            )

    called_paths = [call.args[0] for call in grib.find_band.call_args_list]
    assert called_paths == [paths["u_10m"], paths["v_10m"]]
