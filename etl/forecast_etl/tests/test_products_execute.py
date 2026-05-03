from __future__ import annotations

import gzip
import hashlib
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.config.schema import ExecutionContext
from forecast_etl.encoding.codecs import FORMAT_LINEAR_I8, encode_component_payload
from forecast_etl.proc import RunResult
from forecast_etl.products.execute import run_product_item_in_workdir
from forecast_etl.sources.prepared import PreparedSource
from forecast_etl.stores import make_store
from forecast_etl.tests.product_test_helpers import (
    _cloud_layers_config,
    _minimal_product_config,
    _pack_f32,
    _precip_total_config,
    _product_spec,
    _small_grid_meta_fixture,
    _wind_product_config,
)


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class ArtifactPathContractTest(unittest.TestCase):
    def test_wind_payload_is_co_located_with_weather_payloads(self) -> None:
        ap = ArtifactPaths("file:///tmp/weather-map-artifacts")
        uri = ap.output_vector_payload_uri(
            WorkItem(model_id="gfs", cycle="2026041200", fhour="003", product_id="wind10m_uv", source_uri="file:///dev/null")
        )
        self.assertEqual(
            uri,
            "file:///tmp/weather-map-artifacts/fields/gfs/2026041200/003/wind10m_uv.vector.i8.bin",
        )


class ScalarProductContractTest(unittest.TestCase):
    def test_single_band_scalar_product_writes_scalar_payload(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-scalar-product-") as td:
            out_dir = Path(td) / "out"
            workdir = Path(td) / "work"
            workdir.mkdir(parents=True, exist_ok=True)
            grib_path = Path(td) / "input.grib2"
            grib_path.write_bytes(b"grib")

            artifact_root_uri = f"file://{out_dir.as_posix()}"
            ctx = ExecutionContext(
                model_id="gfs",
                artifact_root_uri=artifact_root_uri,
                forecast_hours=("000",),
            )
            item = WorkItem(
                model_id="gfs",
                cycle="2026041200",
                fhour="003",
                product_id="tmp_surface",
                source_uri="file:///dev/null",
            )
            product = _product_spec("tmp_surface", _minimal_product_config())
            source = _pack_f32([0.0, 1.0, 2.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.products.execute.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TMP"}),
                ),
                patch(
                    "forecast_etl.products.execute.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ),
                patch(
                    "forecast_etl.products.execute.grid_meta_from_grib",
                    return_value=_small_grid_meta_fixture(),
                ),
            ):
                result = run_product_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    product=product,
                    store=make_store(),
                    source=PreparedSource.grib(
                        uri="file:///dev/null",
                        path=grib_path,
                        grid_id="gfs_0p25_global",
                    ),
                    run=_unused_run,
                )

            ap = ArtifactPaths(artifact_root_uri)
            payload_uri = ap.output_scalar_payload_uri(item, dtype="int16")
            payload_path = out_dir / "fields" / "gfs" / "2026041200" / "003" / "tmp_surface.scalar.i16.bin"
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = gzip.decompress(payload_path.read_bytes())
            self.assertEqual(
                payload_bytes,
                struct.pack("<hhhh", 0, 100, 200, -32768),
            )
            self.assertEqual(result["kind"], "scalar")
            self.assertEqual(result["byte_length"], len(payload_bytes))
            self.assertEqual(result["sha256"], hashlib.sha256(payload_bytes).hexdigest())
            self.assertEqual(result["component_grib_matches"]["value"], {"GRIB_ELEMENT": "TMP", "GRIB_SHORT_NAME": "2-HTGL"})
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)

    def test_cloud_layers_product_writes_packed_low_medium_high_scalar_payload(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-cloud-product-") as td:
            out_dir = Path(td) / "out"
            workdir = Path(td) / "work"
            workdir.mkdir(parents=True, exist_ok=True)
            grib_path = Path(td) / "input.grib2"
            grib_path.write_bytes(b"grib")

            artifact_root_uri = f"file://{out_dir.as_posix()}"
            ctx = ExecutionContext(
                model_id="gfs",
                artifact_root_uri=artifact_root_uri,
                forecast_hours=("000",),
            )
            item = WorkItem(
                model_id="gfs",
                cycle="2026041200",
                fhour="003",
                product_id="cloud_layers",
                source_uri="file:///dev/null",
            )
            product = _product_spec("cloud_layers", _cloud_layers_config())

            low_src = _pack_f32([0.0, 5.0, 100.0, float("nan")], byte_order="little")
            medium_src = _pack_f32([10.0, 55.0, 80.0, 25.0], byte_order="little")
            high_src = _pack_f32([15.0, 45.0, 65.0, 95.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.products.execute.find_grib_band_by_metadata",
                    side_effect=[
                        (1, {"GRIB_ELEMENT": "LCDC"}),
                        (2, {"GRIB_ELEMENT": "MCDC"}),
                        (3, {"GRIB_ELEMENT": "HCDC"}),
                    ],
                ),
                patch(
                    "forecast_etl.products.execute.extract_float32_band_bytes",
                    side_effect=[
                        (low_src, "little"),
                        (medium_src, "little"),
                        (high_src, "little"),
                    ],
                ),
                patch(
                    "forecast_etl.products.execute.grid_meta_from_grib",
                    return_value=_small_grid_meta_fixture(),
                ),
            ):
                result = run_product_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    product=product,
                    store=make_store(),
                    source=PreparedSource.grib(
                        uri="file:///dev/null",
                        path=grib_path,
                        grid_id="gfs_0p25_global",
                    ),
                    run=_unused_run,
                )

            ap = ArtifactPaths(artifact_root_uri)
            payload_uri = ap.output_scalar_payload_uri(item, dtype="int8")
            payload_path = out_dir / "fields" / "gfs" / "2026041200" / "003" / "cloud_layers.scalar.i8.bin"
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = gzip.decompress(payload_path.read_bytes())
            expected_payload = (
                struct.pack("bbbb", 0, 1, 20, -128)
                + struct.pack("bbbb", 2, 11, 16, 5)
                + struct.pack("bbbb", 3, 9, 13, 19)
            )
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["dtype"], "int8")
            self.assertEqual(result["components"], ["low", "medium", "high"])
            self.assertNotIn("component_count", result)
            self.assertNotIn("component_order", result)
            self.assertEqual(result["component_grib_matches"]["low"], {"GRIB_ELEMENT": "LCDC"})
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)


class WindProductContractTest(unittest.TestCase):
    def test_wind_product_writes_vector_payload_without_meta_sidecar(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-wind-product-") as td:
            out_dir = Path(td) / "out"
            workdir = Path(td) / "work"
            workdir.mkdir(parents=True, exist_ok=True)
            grib_path = Path(td) / "input.grib2"
            grib_path.write_bytes(b"grib")

            artifact_root_uri = f"file://{out_dir.as_posix()}"
            ctx = ExecutionContext(
                model_id="gfs",
                artifact_root_uri=artifact_root_uri,
                forecast_hours=("000",),
            )
            item = WorkItem(
                model_id="gfs",
                cycle="2026041200",
                fhour="003",
                product_id="wind10m_uv",
                source_uri="file:///dev/null",
            )
            product = _product_spec("wind10m_uv", _wind_product_config())

            u_src = _pack_f32([0.0, 1.0, -1.0, 20.0], byte_order="little")
            v_src = _pack_f32([2.0, -2.0, 0.5, -0.5], byte_order="little")

            with (
                patch(
                    "forecast_etl.products.execute.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (2, {"id": "v"})],
                ),
                patch(
                    "forecast_etl.products.execute.extract_float32_band_bytes",
                    side_effect=[(u_src, "little"), (v_src, "little")],
                ),
                patch(
                    "forecast_etl.products.execute.grid_meta_from_grib",
                    return_value=_small_grid_meta_fixture(),
                ),
            ):
                result = run_product_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    product=product,
                    store=make_store(),
                    source=PreparedSource.grib(
                        uri="file:///dev/null",
                        path=grib_path,
                        grid_id="gfs_0p25_global",
                    ),
                    run=_unused_run,
                )

            ap = ArtifactPaths(artifact_root_uri)
            payload_uri = ap.output_vector_payload_uri(item)
            payload_path = out_dir / "fields" / "gfs" / "2026041200" / "003" / "wind10m_uv.vector.i8.bin"
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = gzip.decompress(payload_path.read_bytes())
            expected_u = encode_component_payload(
                source_f32_bytes=u_src,
                source_byte_order="little",
                target_dtype="int8",
                target_byte_order="none",
                target_format=FORMAT_LINEAR_I8,
                scale=0.5,
                offset=0.0,
            )
            expected_v = encode_component_payload(
                source_f32_bytes=v_src,
                source_byte_order="little",
                target_dtype="int8",
                target_byte_order="none",
                target_format=FORMAT_LINEAR_I8,
                scale=0.5,
                offset=0.0,
            )
            expected_payload = expected_u + expected_v
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "linear-i8-v1")
            self.assertEqual(result["dtype"], "int8")
            self.assertEqual(result["components"], ["u", "v"])
            self.assertNotIn("component_count", result)
            self.assertNotIn("component_order", result)
            self.assertEqual(result["encoding_id"], "wind10m_uv_vector_i8_v1")
            self.assertEqual(result["grid_id"], "gfs_0p25_global")
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)

            legacy_meta_path = out_dir / "wind" / "2026041200.wind10m_uv.003.uv.meta.json"
            self.assertFalse(legacy_meta_path.exists())


class IconGribCollectionProductTest(unittest.TestCase):
    def test_precip_total_scalar_uses_icon_param_grib_path_and_encoding(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-icon-precip-product-") as td:
            out_dir = Path(td) / "out"
            workdir = Path(td) / "work"
            workdir.mkdir(parents=True, exist_ok=True)
            grib_path = Path(td) / "tot_prec.regridded.grib2"
            grib_path.write_bytes(b"grib")

            artifact_root_uri = f"file://{out_dir.as_posix()}"
            ctx = ExecutionContext(
                model_id="icon",
                artifact_root_uri=artifact_root_uri,
                forecast_hours=("000",),
            )
            item = WorkItem(
                model_id="icon",
                cycle="2026041200",
                fhour="003",
                product_id="precip_total_surface",
                source_uri="icon-dwd://icon/2026041200/003",
            )
            product = _product_spec("precip_total_surface", _precip_total_config())
            source = _pack_f32([0.0, 1.0, 254.0, float("nan")], byte_order="little")

            with (
                patch(
                    "forecast_etl.products.execute.find_grib_band_by_metadata",
                    return_value=(1, {"GRIB_ELEMENT": "TOT_PREC"}),
                ) as find_band,
                patch(
                    "forecast_etl.products.execute.extract_float32_band_bytes",
                    return_value=(source, "little"),
                ) as extract_band,
                patch(
                    "forecast_etl.products.execute.grid_meta_from_grib",
                    return_value=_small_grid_meta_fixture(),
                ),
            ):
                result = run_product_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    product=product,
                    store=make_store(),
                    source=PreparedSource.grib_collection(
                        uri="icon-dwd://icon/2026041200/003",
                        grib_paths={"tot_prec": grib_path},
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

            find_band.assert_called_once_with(grib_path, {}, run=_unused_run)
            self.assertEqual(extract_band.call_args.kwargs["grib_path"], grib_path)
            payload_path = out_dir / "fields" / "icon" / "2026041200" / "003" / "precip_total_surface.scalar.i8.bin"
            payload_bytes = gzip.decompress(payload_path.read_bytes())
            expected_payload = struct.pack("bbbb", -127, -126, 127, -128)
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["payload_uri"], f"{artifact_root_uri}/fields/icon/2026041200/003/precip_total_surface.scalar.i8.bin")
            self.assertEqual(result["encoding_id"], "precip_total_surface_i8_1mm_v1")
            self.assertEqual(result["units"], "mm")
            self.assertEqual(result["component_grib_matches"]["value"], {"ICON_PARAM": "tot_prec"})
            self.assertEqual(result["grid_id"], "icon_global_regridded_0p125")

    def test_icon_cloud_layers_use_component_specific_grib_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-icon-cloud-product-") as td:
            out_dir = Path(td) / "out"
            workdir = Path(td) / "work"
            workdir.mkdir(parents=True, exist_ok=True)
            paths = {
                "clcl": Path(td) / "clcl.regridded.grib2",
                "clcm": Path(td) / "clcm.regridded.grib2",
                "clch": Path(td) / "clch.regridded.grib2",
            }
            for path in paths.values():
                path.write_bytes(b"grib")

            artifact_root_uri = f"file://{out_dir.as_posix()}"
            ctx = ExecutionContext(model_id="icon", artifact_root_uri=artifact_root_uri, forecast_hours=("000",))
            item = WorkItem(
                model_id="icon",
                cycle="2026041200",
                fhour="003",
                product_id="cloud_layers",
                source_uri="icon-dwd://icon/2026041200/003",
            )
            product_config = _cloud_layers_config()
            product_config["components"][0]["grib_match"] = {"ICON_PARAM": "clcl"}
            product_config["components"][1]["grib_match"] = {"ICON_PARAM": "clcm"}
            product_config["components"][2]["grib_match"] = {"ICON_PARAM": "clch"}
            product = _product_spec("cloud_layers", product_config)
            component_source = _pack_f32([0.0, 5.0, 10.0, 15.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.products.execute.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "low"}), (1, {"id": "medium"}), (1, {"id": "high"})],
                ) as find_band,
                patch(
                    "forecast_etl.products.execute.extract_float32_band_bytes",
                    return_value=(component_source, "little"),
                ),
                patch(
                    "forecast_etl.products.execute.grid_meta_from_grib",
                    return_value=_small_grid_meta_fixture(),
                ),
            ):
                run_product_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    product=product,
                    store=make_store(),
                    source=PreparedSource.grib_collection(
                        uri="icon-dwd://icon/2026041200/003",
                        grib_paths=paths,
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [paths["clcl"], paths["clcm"], paths["clch"]])

    def test_icon_wind_uses_u_and_v_grib_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-icon-wind-product-") as td:
            out_dir = Path(td) / "out"
            workdir = Path(td) / "work"
            workdir.mkdir(parents=True, exist_ok=True)
            paths = {
                "u_10m": Path(td) / "u_10m.regridded.grib2",
                "v_10m": Path(td) / "v_10m.regridded.grib2",
            }
            for path in paths.values():
                path.write_bytes(b"grib")

            artifact_root_uri = f"file://{out_dir.as_posix()}"
            ctx = ExecutionContext(model_id="icon", artifact_root_uri=artifact_root_uri, forecast_hours=("000",))
            item = WorkItem(
                model_id="icon",
                cycle="2026041200",
                fhour="003",
                product_id="wind10m_uv",
                source_uri="icon-dwd://icon/2026041200/003",
            )
            product_config = _wind_product_config()
            product_config["components"][0]["grib_match"] = {"ICON_PARAM": "u_10m"}
            product_config["components"][1]["grib_match"] = {"ICON_PARAM": "v_10m"}
            product = _product_spec("wind10m_uv", product_config)
            u_src = _pack_f32([1.0, 2.0, 3.0, 4.0], byte_order="little")
            v_src = _pack_f32([-1.0, -2.0, -3.0, -4.0], byte_order="little")

            with (
                patch(
                    "forecast_etl.products.execute.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (1, {"id": "v"})],
                ) as find_band,
                patch(
                    "forecast_etl.products.execute.extract_float32_band_bytes",
                    side_effect=[(u_src, "little"), (v_src, "little")],
                ),
                patch(
                    "forecast_etl.products.execute.grid_meta_from_grib",
                    return_value=_small_grid_meta_fixture(),
                ),
            ):
                run_product_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    product=product,
                    store=make_store(),
                    source=PreparedSource.grib_collection(
                        uri="icon-dwd://icon/2026041200/003",
                        grib_paths=paths,
                        grid_id="icon_global_regridded_0p125",
                    ),
                    run=_unused_run,
                )

        called_paths = [call.args[0] for call in find_band.call_args_list]
        self.assertEqual(called_paths, [paths["u_10m"], paths["v_10m"]])
