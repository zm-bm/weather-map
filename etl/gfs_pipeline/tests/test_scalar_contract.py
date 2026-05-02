from __future__ import annotations

import gzip
import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gfs_pipeline.config import ExecutionContext, PipelineConfig
from gfs_pipeline.contracts import ArtifactPaths, WorkItem
from gfs_pipeline.publish import run_publish
from gfs_pipeline.scalar_encoding import is_linear_scalar_format, scalar_format_for_encoding
from gfs_pipeline.scalar_product import encode_scalar_f32_to_i16_payload, encode_scalar_f32_to_payload
from gfs_pipeline.stores import make_store
from gfs_pipeline.wind_codec import quantize_f32_to_i8_q0p5
from gfs_pipeline.vector_product import run_vector_item_in_workdir


def _write_json(uri: str, obj: dict) -> None:
    store = make_store()
    store.write_bytes(uri=uri, data=(json.dumps(obj, sort_keys=True) + "\n").encode("utf-8"))


def _pack_f32(values: list[float], *, byte_order: str) -> bytes:
    prefix = "<" if byte_order == "little" else ">"
    return b"".join(struct.pack(f"{prefix}f", float(value)) for value in values)


def _minimal_layer_config() -> dict:
    return {
        "parameter": "tmp",
        "level": "surface",
        "grib_match": {
            "GRIB_ELEMENT": "TMP",
            "GRIB_SHORT_NAME": "2-HTGL",
        },
        "units": "C",
        "scale_min": -45,
        "scale_max": 50,
        "scalar_source_transform": "identity",
        "scalar_encoding": {
            "encoding_id": "tmp_surface_i16_v1",
            "dtype": "int16",
            "byte_order": "little",
            "scale": 0.01,
            "offset": 0.0,
            "nodata": -32768,
        },
    }


def _minimal_pipeline_config() -> dict:
    return {
        "workload": {
            "forecast_hour_start": 0,
            "forecast_hour_end": 0,
            "variables": ["tmp_surface"],
        },
        "nomads": {
            "base_url": "https://example.test",
            "vars_levels": {},
            "rate_limit_seconds": 0.0,
        },
        "scalar_variables": {
            "tmp_surface": _minimal_layer_config(),
        },
        "scalar_variable_groups": [
            {
                "id": "temperature",
                "label": "Temperature",
                "default_variable": "tmp_surface",
                "variables": ["tmp_surface"],
            },
        ],
        "vector_variables": {},
    }


def _grid_meta_fixture() -> dict[str, object]:
    return {
        "crs": "EPSG:4326",
        "nx": 4,
        "ny": 3,
        "lon0": -180.0,
        "lat0": 90.0,
        "dx": 0.25,
        "dy": -0.25,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def _write_scalar_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    source_values: list[float],
    scalar_config: dict,
    grid_meta: dict[str, object],
) -> None:
    scalar_encoding = scalar_config["scalar_encoding"]
    dtype = str(scalar_encoding["dtype"])
    scalar_format = scalar_format_for_encoding(
        dtype=dtype,
        explicit_format=scalar_encoding.get("format"),
    )
    payload = encode_scalar_f32_to_payload(
        source_f32_bytes=_pack_f32(source_values, byte_order="little"),
        source_byte_order="little",
        target_dtype=dtype,
        target_byte_order=str(scalar_encoding["byte_order"]),
        target_format=scalar_format,
        scale=float(scalar_encoding["scale"]) if is_linear_scalar_format(scalar_format) else None,
        offset=float(scalar_encoding["offset"]) if is_linear_scalar_format(scalar_format) else None,
        nodata=int(scalar_encoding["nodata"]),
        source_transform=str(scalar_config.get("scalar_source_transform", "identity")),
    )
    payload_sha = hashlib.sha256(payload).hexdigest()
    item = WorkItem(cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
    payload_uri = ap.output_scalar_payload_uri(
        item=item,
        dtype=dtype,
    )
    store.write_bytes(uri=payload_uri, data=payload)
    scalar_marker = {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": payload_sha,
        "format": scalar_format,
        "dtype": dtype,
        "byte_order": str(scalar_encoding["byte_order"]),
        "encoding_id": str(scalar_encoding["encoding_id"]),
        "nodata": int(scalar_encoding["nodata"]),
        "grid": grid_meta,
    }
    if is_linear_scalar_format(scalar_format):
        scalar_marker["scale"] = float(scalar_encoding["scale"])
        scalar_marker["offset"] = float(scalar_encoding["offset"])
        scalar_marker["decode_formula"] = "value = stored * scale + offset"

    _write_json(
        ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "layer": variable,
            "kind": "scalar",
            "scalar": scalar_marker,
        },
    )


def _write_vector_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    grid_meta: dict[str, object],
) -> None:
    component_bytes = int(grid_meta["nx"]) * int(grid_meta["ny"])
    u_bytes = bytes((i % 128) for i in range(component_bytes))
    v_bytes = bytes(((i + 7) % 128) for i in range(component_bytes))
    payload = u_bytes + v_bytes
    payload_sha = hashlib.sha256(payload).hexdigest()
    payload_uri = ap.output_vector_payload_uri(
        item=WorkItem(cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
    )
    store.write_bytes(uri=payload_uri, data=payload)
    _write_json(
        ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "layer": variable,
            "kind": "vector",
            "vector": {
                "payload_uri": payload_uri,
                "byte_length": len(payload),
                "sha256": payload_sha,
                "format": "uv-i8-q0p5-v1",
                "dtype": "int8",
                "byte_order": "none",
                "scale": 0.5,
                "offset": 0.0,
                "decode_formula": "value = stored * scale + offset",
                "components": ["u", "v"],
                "component_count": 2,
                "component_order": "u_then_v",
                "encoding_id": "wind10m_uv_vector_i8_v1",
                "units": "m/s",
                "parameter": "wind_uv",
                "level": "10m_above_ground",
                "valid_min": -64.0,
                "valid_max": 63.5,
                "grid_id": "gfs_0p25_global",
                "grid": grid_meta,
            },
        },
    )


class ScalarPayloadTest(unittest.TestCase):
    def test_encode_scalar_payload_identity_transform_and_target_byte_order(self) -> None:
        source = _pack_f32([0.0, 1.0, 2.0], byte_order="little")
        payload = encode_scalar_f32_to_i16_payload(
            source_f32_bytes=source,
            source_byte_order="little",
            target_byte_order="big",
            scale=0.01,
            offset=0.0,
            nodata=-32768,
            source_transform="identity",
        )
        values = [struct.unpack_from(">h", payload, offset=i * 2)[0] for i in range(3)]
        self.assertEqual(values, [0, 100, 200])
        self.assertEqual(len(payload), 3 * 2)

    def test_encode_scalar_payload_maps_invalid_and_reserves_nodata(self) -> None:
        source = _pack_f32([float("nan"), float("inf"), float("-inf"), -40000.0, 40000.0, -32768.0], byte_order="little")
        payload = encode_scalar_f32_to_i16_payload(
            source_f32_bytes=source,
            source_byte_order="little",
            target_byte_order="little",
            scale=1.0,
            offset=0.0,
            nodata=-32768,
            source_transform="identity",
        )
        values = [struct.unpack_from("<h", payload, offset=i * 2)[0] for i in range(6)]
        self.assertEqual(values[0:3], [-32768, -32768, -32768])
        self.assertEqual(values[3], -32767)
        self.assertEqual(values[4], 32767)
        self.assertEqual(values[5], -32767)

        high_nodata_payload = encode_scalar_f32_to_i16_payload(
            source_f32_bytes=_pack_f32([40000.0], byte_order="little"),
            source_byte_order="little",
            target_byte_order="little",
            scale=1.0,
            offset=0.0,
            nodata=32767,
            source_transform="identity",
        )
        high_nodata = struct.unpack_from("<h", high_nodata_payload, offset=0)[0]
        self.assertEqual(high_nodata, 32766)

    def test_encode_scalar_payload_supports_int8_linear_encoding(self) -> None:
        payload = encode_scalar_f32_to_payload(
            source_f32_bytes=_pack_f32([0.0, 50.0, 100.0, float("nan")], byte_order="little"),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            scale=0.5,
            offset=50.0,
            nodata=-128,
            source_transform="identity",
        )

        self.assertEqual(list(struct.unpack("bbbb", payload)), [-100, 0, 100, -128])

    def test_encode_scalar_payload_applies_precipitation_rate_transform(self) -> None:
        payload = encode_scalar_f32_to_payload(
            source_f32_bytes=_pack_f32([0.0, 0.001, 0.008333333, float("nan")], byte_order="little"),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            scale=0.15,
            offset=19.05,
            nodata=-128,
            source_transform="kg_m2_s_to_mm_hr",
        )

        self.assertEqual(list(struct.unpack("bbbb", payload)), [-127, -103, 73, -128])

    def test_encode_scalar_payload_supports_temperature_piecewise_encoding(self) -> None:
        payload = encode_scalar_f32_to_payload(
            source_f32_bytes=_pack_f32(
                [-100.0, -35.0, -8.0, -7.75, 34.0, 34.5, 50.0, 100.0, float("nan")],
                byte_order="little",
            ),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            target_format="scalar-i8-temp-c-piecewise-v1",
            nodata=-128,
            source_transform="identity",
        )

        self.assertEqual(list(struct.unpack("bbbbbbbbb", payload)), [-127, -127, -73, -72, 95, 96, 127, 127, -128])


class ConfigValidationTest(unittest.TestCase):
    def test_pipeline_config_parses_forecast_hour_range(self) -> None:
        parsed = PipelineConfig.from_obj(_minimal_pipeline_config())
        self.assertEqual(parsed.workload.forecast_hours, ("000",))
        self.assertEqual(parsed.workload.variables, ("tmp_surface",))
        self.assertIn("tmp_surface", parsed.scalar_variables)
        self.assertEqual(parsed.scalar_variable_groups[0]["id"], "temperature")
        self.assertEqual(parsed.scalar_variable_groups[0]["default_variable"], "tmp_surface")

    def test_pipeline_config_still_accepts_explicit_forecast_hours(self) -> None:
        parsed = PipelineConfig.from_obj(
            {
                **_minimal_pipeline_config(),
                "workload": {
                    "forecast_hours": ["000", "003", "006"],
                    "variables": ["tmp_surface"],
                },
            }
        )
        self.assertEqual(parsed.workload.forecast_hours, ("000", "003", "006"))

    def test_pipeline_config_rejects_invalid_forecast_hour_range(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        bad_cfg["workload"]["forecast_hour_start"] = 12
        bad_cfg["workload"]["forecast_hour_end"] = 6

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(bad_cfg)

    def test_pipeline_config_requires_scalar_encoding(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        del bad_cfg["scalar_variables"]["tmp_surface"]["scalar_encoding"]

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(bad_cfg)

    def test_pipeline_config_rejects_invalid_scalar_source_transform(self) -> None:
        bad_cfg = _minimal_pipeline_config()
        bad_cfg["scalar_variables"]["tmp_surface"]["scalar_source_transform"] = "bogus_transform"

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(bad_cfg)

    def test_pipeline_config_accepts_precipitation_rate_source_transform(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["scalar_variables"]["tmp_surface"]["scalar_source_transform"] = "kg_m2_s_to_mm_hr"

        parsed = PipelineConfig.from_obj(cfg)

        self.assertEqual(
            parsed.scalar_variables["tmp_surface"]["scalar_source_transform"],
            "kg_m2_s_to_mm_hr",
        )

    def test_pipeline_config_accepts_temperature_piecewise_encoding_without_scale_offset(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["scalar_variables"]["tmp_surface"]["scalar_encoding"] = {
            "encoding_id": "tmp_surface_i8_temp_c_piecewise_v1",
            "format": "scalar-i8-temp-c-piecewise-v1",
            "dtype": "int8",
            "byte_order": "none",
            "nodata": -128,
        }

        parsed = PipelineConfig.from_obj(cfg)

        self.assertEqual(
            parsed.scalar_variables["tmp_surface"]["scalar_encoding"]["format"],
            "scalar-i8-temp-c-piecewise-v1",
        )

    def test_pipeline_config_rejects_scalar_group_missing_workload_variable(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["workload"]["variables"] = ["tmp_surface", "rh_surface"]
        cfg["scalar_variables"]["rh_surface"] = {
            **_minimal_layer_config(),
            "parameter": "rh",
        }

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(cfg)

    def test_pipeline_config_rejects_scalar_group_default_outside_group(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["scalar_variable_groups"][0]["default_variable"] = "rh_surface"

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(cfg)

    def test_pipeline_config_rejects_scalar_group_unknown_variable(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["scalar_variable_groups"][0]["variables"] = ["missing_surface"]
        cfg["scalar_variable_groups"][0]["default_variable"] = "missing_surface"

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(cfg)

    def test_pipeline_config_rejects_scalar_group_duplicate_variable(self) -> None:
        cfg = _minimal_pipeline_config()
        cfg["scalar_variable_groups"].append(
            {
                "id": "duplicate",
                "label": "Duplicate",
                "default_variable": "tmp_surface",
                "variables": ["tmp_surface"],
            }
        )

        with self.assertRaises(SystemExit):
            PipelineConfig.from_obj(cfg)


class ArtifactPathContractTest(unittest.TestCase):
    def test_wind_payload_is_co_located_with_weather_payloads(self) -> None:
        ap = ArtifactPaths("file:///tmp/weather-map-artifacts")
        uri = ap.output_vector_payload_uri(
            WorkItem(cycle="2026041200", fhour="003", layer="wind10m_uv", source_uri="file:///dev/null")
        )
        self.assertEqual(
            uri,
            "file:///tmp/weather-map-artifacts/fields/2026041200/003/wind10m_uv.vector.i8.bin",
        )


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
                artifact_root_uri=artifact_root_uri,
                forecast_hours=("000",),
            )
            item = WorkItem(
                cycle="2026041200",
                fhour="003",
                layer="wind10m_uv",
                source_uri="file:///dev/null",
            )
            vector_variable = {
                "u_grib_match": {"GRIB_ELEMENT": "UGRD"},
                "v_grib_match": {"GRIB_ELEMENT": "VGRD"},
                "units": "m/s",
                "parameter": "wind_uv",
                "level": "10m_above_ground",
                "encoding_id": "wind10m_uv_vector_i8_v1",
            }

            u_src = _pack_f32([0.0, 1.0, -1.0, 20.0], byte_order="little")
            v_src = _pack_f32([2.0, -2.0, 0.5, -0.5], byte_order="little")

            with (
                patch(
                    "gfs_pipeline.vector_product.gdal_ops.find_grib_band_by_metadata",
                    side_effect=[(1, {"id": "u"}), (2, {"id": "v"})],
                ),
                patch(
                    "gfs_pipeline.vector_product.extract_float32_band_bytes",
                    side_effect=[(u_src, "little"), (v_src, "little")],
                ),
                patch(
                    "gfs_pipeline.vector_product.gdal_ops.gdalinfo_json",
                    return_value={
                        "size": [2, 2],
                        "geoTransform": [-180.125, 0.25, 0.0, 90.125, 0.0, -0.25],
                    },
                ),
            ):
                result = run_vector_item_in_workdir(
                    workdir=workdir,
                    ctx=ctx,
                    item=item,
                    vector_variable=vector_variable,
                    store=make_store(),
                    grib_path=grib_path,
                    run=lambda *_args, **_kwargs: None,
                )

            ap = ArtifactPaths(artifact_root_uri)
            payload_uri = ap.output_vector_payload_uri(item)
            payload_path = out_dir / "fields" / "2026041200" / "003" / "wind10m_uv.vector.i8.bin"
            self.assertEqual(result["payload_uri"], payload_uri)
            self.assertTrue(payload_path.exists())

            payload_bytes = gzip.decompress(payload_path.read_bytes())
            expected_u = quantize_f32_to_i8_q0p5(u_src, byte_order="little")
            expected_v = quantize_f32_to_i8_q0p5(v_src, byte_order="little")
            expected_payload = expected_u + expected_v
            self.assertEqual(payload_bytes, expected_payload)
            self.assertEqual(result["byte_length"], len(expected_payload))
            self.assertEqual(result["sha256"], hashlib.sha256(expected_payload).hexdigest())
            self.assertEqual(result["format"], "uv-i8-q0p5-v1")
            self.assertEqual(result["dtype"], "int8")
            self.assertEqual(result["components"], ["u", "v"])
            self.assertEqual(result["component_count"], 2)
            self.assertEqual(result["component_order"], "u_then_v")
            self.assertEqual(result["encoding_id"], "wind10m_uv_vector_i8_v1")
            self.assertEqual(result["grid_id"], "gfs_0p25_global")
            self.assertEqual(result["grid"]["lon0"], -180.0)
            self.assertEqual(result["grid"]["lat0"], 90.0)

            legacy_meta_path = out_dir / "wind" / "2026041200.wind10m_uv.003.uv.meta.json"
            self.assertFalse(legacy_meta_path.exists())


class PublishScalarManifestTest(unittest.TestCase):
    def test_publish_writes_scalar_manifest_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-scalar-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000", "003")
            variables = ("tmp_surface", "rh_surface")

            ctx = ExecutionContext(
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            )

            scalar_variables_cfg = {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "scale_min": -45.0,
                    "scale_max": 50.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                },
                "rh_surface": {
                    "parameter": "rh",
                    "level": "surface",
                    "units": "%",
                    "scale_min": 0.0,
                    "scale_max": 100.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "rh_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                },
            }

            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()

            for fhour in fhours:
                for variable in variables:
                    source_values = (
                        [-10.0 + float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))]
                        if variable == "tmp_surface"
                        else [20.0 + float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))]
                    )
                    _write_scalar_marker(
                        store=store,
                        ap=ap,
                        cycle=cycle,
                        fhour=fhour,
                        variable=variable,
                        source_values=source_values,
                        scalar_config=scalar_variables_cfg[variable],
                        grid_meta=grid_meta,
                    )

            result_first = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result_first.ready)
            self.assertFalse(result_first.already_published)

            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle)).decode("utf-8"))
            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri()).decode("utf-8"))

            self.assertEqual(cycle_manifest["version"], 4)
            self.assertEqual(cycle_manifest["contract"], "forecast-binary-v2")
            self.assertEqual(cycle_manifest["scalar_variables"], list(variables))
            self.assertEqual(
                cycle_manifest["scalar_variable_groups"],
                [
                    {
                        "id": "layers",
                        "label": "Layers",
                        "default_variable": "tmp_surface",
                        "variables": list(variables),
                    },
                ],
            )
            self.assertEqual(cycle_manifest["vector_variables"], [])
            self.assertIn("frames", cycle_manifest)
            self.assertEqual(
                cycle_manifest["frames"]["000"]["tmp_surface"]["path"],
                f"fields/{cycle}/000/tmp_surface.scalar.i16.bin",
            )
            self.assertEqual(
                cycle_manifest["frames"]["003"]["rh_surface"]["path"],
                f"fields/{cycle}/003/rh_surface.scalar.i16.bin",
            )
            self.assertEqual(latest_manifest, cycle_manifest)

            for fhour in fhours:
                for variable in variables:
                    frame = cycle_manifest["frames"][fhour][variable]
                    self.assertEqual(frame["byte_length"], int(grid_meta["nx"]) * int(grid_meta["ny"]) * 2)
                    payload_uri = ap.output_scalar_payload_uri(
                        item=WorkItem(cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
                    )
                    payload_bytes = gzip.decompress(store.read_bytes(uri=payload_uri))
                    self.assertEqual(len(payload_bytes), frame["byte_length"])
                    self.assertEqual(hashlib.sha256(payload_bytes).hexdigest(), frame["sha256"])

            result_second = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

    def test_publish_revision_includes_scalar_variable_groups(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-groups-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            variables = ("tmp_surface",)
            scalar_variables_cfg = {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "scale_min": -45.0,
                    "scale_max": 50.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                },
            }

            ctx = ExecutionContext(artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()
            _write_scalar_marker(
                store=store,
                ap=ap,
                cycle=cycle,
                fhour="000",
                variable="tmp_surface",
                source_values=[float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))],
                scalar_config=scalar_variables_cfg["tmp_surface"],
                grid_meta=grid_meta,
            )

            run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
                scalar_variable_groups=[
                    {
                        "id": "temperature",
                        "label": "Temperature",
                        "default_variable": "tmp_surface",
                        "variables": ["tmp_surface"],
                    },
                ],
            )
            first_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle)).decode("utf-8"))

            run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
                scalar_variable_groups=[
                    {
                        "id": "layers",
                        "label": "Layers",
                        "default_variable": "tmp_surface",
                        "variables": ["tmp_surface"],
                    },
                ],
            )
            second_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle)).decode("utf-8"))

            self.assertNotEqual(first_manifest["revision"], second_manifest["revision"])
            self.assertEqual(second_manifest["scalar_variable_groups"][0]["id"], "layers")

    def test_publish_writes_temperature_piecewise_encoding_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-temp-piecewise-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            variables = ("tmp_surface",)
            scalar_variables_cfg = {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "scale_min": -35.0,
                    "scale_max": 50.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i8_temp_c_piecewise_v1",
                        "format": "scalar-i8-temp-c-piecewise-v1",
                        "dtype": "int8",
                        "byte_order": "none",
                        "nodata": -128,
                    },
                },
            }

            ctx = ExecutionContext(artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()
            _write_scalar_marker(
                store=store,
                ap=ap,
                cycle=cycle,
                fhour="000",
                variable="tmp_surface",
                source_values=[-35.0 + float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))],
                scalar_config=scalar_variables_cfg["tmp_surface"],
                grid_meta=grid_meta,
            )

            result = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )

            self.assertTrue(result.ready)
            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle)).decode("utf-8"))
            encoding = cycle_manifest["encodings"]["tmp_surface_i8_temp_c_piecewise_v1"]
            self.assertEqual(
                encoding,
                {
                    "format": "scalar-i8-temp-c-piecewise-v1",
                    "dtype": "int8",
                    "byte_order": "none",
                    "nodata": -128,
                },
            )
            self.assertEqual(
                cycle_manifest["frames"]["000"]["tmp_surface"]["path"],
                f"fields/{cycle}/000/tmp_surface.scalar.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["frames"]["000"]["tmp_surface"]["byte_length"],
                int(grid_meta["nx"]) * int(grid_meta["ny"]),
            )

    def test_publish_does_not_promote_older_cycle_over_newer_latest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-monotonic-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            fhours = ("000",)
            cycle_old = "2026041100"
            cycle_new = "2026041200"
            scalar_variables = ("tmp_surface",)
            scalar_variables_cfg = {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "scale_min": -45.0,
                    "scale_max": 50.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                },
            }

            ctx = ExecutionContext(artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()

            for cycle_value, base in ((cycle_new, 10.0), (cycle_old, -10.0)):
                _write_scalar_marker(
                    store=store,
                    ap=ap,
                    cycle=cycle_value,
                    fhour="000",
                    variable="tmp_surface",
                    source_values=[base + float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))],
                    scalar_config=scalar_variables_cfg["tmp_surface"],
                    grid_meta=grid_meta,
                )

            result_new = run_publish(
                ctx=ctx,
                cycle=cycle_new,
                scalar_variables=scalar_variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result_new.ready)

            result_old = run_publish(
                ctx=ctx,
                cycle=cycle_old,
                scalar_variables=scalar_variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result_old.ready)

            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri()).decode("utf-8"))
            old_cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle_old)).decode("utf-8"))
            new_cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle_new)).decode("utf-8"))
            self.assertEqual(latest_manifest, new_cycle_manifest)
            self.assertNotEqual(latest_manifest["cycle"], old_cycle_manifest["cycle"])

    def test_republish_same_cycle_refreshes_latest_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-refresh-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            scalar_variables = ("tmp_surface",)
            scalar_variables_cfg = {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "scale_min": -45.0,
                    "scale_max": 50.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                },
            }

            ctx = ExecutionContext(artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()

            _write_scalar_marker(
                store=store,
                ap=ap,
                cycle=cycle,
                fhour="000",
                variable="tmp_surface",
                source_values=[float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))],
                scalar_config=scalar_variables_cfg["tmp_surface"],
                grid_meta=grid_meta,
            )

            result_first = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=scalar_variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result_first.ready)
            initial_latest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri()).decode("utf-8"))

            _write_json(
                ap.manifest_latest_uri(),
                {
                    "cycle": "2026041000",
                    "generated_at": "2026-04-10T00:00:00+00:00",
                    "revision": "stale",
                },
            )

            result_second = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=scalar_variables,
                vector_variables=(),
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

            refreshed_latest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri()).decode("utf-8"))
            self.assertEqual(refreshed_latest, initial_latest)

    def test_publish_writes_vector_only_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-vector-only-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041200"
            fhours = ("000", "003")
            vector_variables = ("wind10m_uv",)

            ctx = ExecutionContext(
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            )

            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()

            for fhour in fhours:
                _write_vector_marker(
                    store=store,
                    ap=ap,
                    cycle=cycle,
                    fhour=fhour,
                    variable="wind10m_uv",
                    grid_meta=grid_meta,
                )

            result = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=(),
                vector_variables=vector_variables,
                scalar_variables_cfg={},
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle)).decode("utf-8"))
            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri()).decode("utf-8"))
            self.assertEqual(cycle_manifest["scalar_variables"], [])
            self.assertEqual(cycle_manifest["vector_variables"], ["wind10m_uv"])
            self.assertEqual(latest_manifest, cycle_manifest)
            self.assertEqual(
                cycle_manifest["frames"]["000"]["wind10m_uv"]["path"],
                f"fields/{cycle}/000/wind10m_uv.vector.i8.bin",
            )

    def test_publish_includes_wind_frames_and_metadata_without_sidecars(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-wind-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041200"
            fhours = ("000", "003")
            scalar_variables = ("tmp_surface",)
            vector_variables = ("wind10m_uv",)

            ctx = ExecutionContext(
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            )

            scalar_variables_cfg = {
                "tmp_surface": {
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "scale_min": -45.0,
                    "scale_max": 50.0,
                    "scalar_source_transform": "identity",
                    "scalar_encoding": {
                        "encoding_id": "tmp_surface_i16_v1",
                        "dtype": "int16",
                        "byte_order": "little",
                        "scale": 0.01,
                        "offset": 0.0,
                        "nodata": -32768,
                    },
                },
            }

            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()

            for fhour in fhours:
                _write_scalar_marker(
                    store=store,
                    ap=ap,
                    cycle=cycle,
                    fhour=fhour,
                    variable="tmp_surface",
                    source_values=[-10.0 + float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))],
                    scalar_config=scalar_variables_cfg["tmp_surface"],
                    grid_meta=grid_meta,
                )
                _write_vector_marker(
                    store=store,
                    ap=ap,
                    cycle=cycle,
                    fhour=fhour,
                    variable="wind10m_uv",
                    grid_meta=grid_meta,
                )

            result = run_publish(
                ctx=ctx,
                cycle=cycle,
                scalar_variables=scalar_variables,
                vector_variables=vector_variables,
                scalar_variables_cfg=scalar_variables_cfg,
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(cycle=cycle)).decode("utf-8"))
            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri()).decode("utf-8"))
            self.assertEqual(cycle_manifest["version"], 4)
            self.assertEqual(cycle_manifest["contract"], "forecast-binary-v2")
            self.assertEqual(cycle_manifest["scalar_variables"], ["tmp_surface"])
            self.assertEqual(cycle_manifest["vector_variables"], ["wind10m_uv"])
            self.assertEqual(
                cycle_manifest["frames"]["000"]["wind10m_uv"]["path"],
                f"fields/{cycle}/000/wind10m_uv.vector.i8.bin",
            )
            self.assertIn("wind10m_uv_vector_i8_v1", cycle_manifest["encodings"])
            self.assertEqual(
                cycle_manifest["encodings"]["wind10m_uv_vector_i8_v1"]["component_count"],
                2,
            )
            self.assertEqual(cycle_manifest["variable_meta"]["tmp_surface"]["kind"], "scalar")
            self.assertEqual(cycle_manifest["variable_meta"]["wind10m_uv"]["kind"], "vector")
            self.assertEqual(latest_manifest, cycle_manifest)


if __name__ == "__main__":
    unittest.main()
