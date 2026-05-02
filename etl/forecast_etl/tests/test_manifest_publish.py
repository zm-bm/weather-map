from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.config.schema import ExecutionContext
from forecast_etl.manifest.publish import run_publish
from forecast_etl.stores import make_store
from forecast_etl.tests.product_test_helpers import (
    _cloud_layers_config,
    _grid_meta_fixture,
    _minimal_layer_config,
    _product_specs,
    _scalar_group,
    _wind_product_config,
    _write_json,
    _write_packed_cloud_scalar_marker,
    _write_scalar_marker,
    _write_vector_marker,
)


class PublishScalarManifestTest(unittest.TestCase):
    def test_publish_writes_scalar_manifest_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-scalar-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000", "003")
            variables = ("tmp_surface", "rh_surface")

            ctx = ExecutionContext(
                model_id="gfs",
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            )

            products_cfg = {
                "tmp_surface": _minimal_layer_config(),
                "rh_surface": {
                    **_minimal_layer_config(),
                    "level": "surface",
                    "parameter": "rh",
                    "units": "%",
                    "valid_min": 0.0,
                    "valid_max": 100.0,
                    "encoding": {
                        "id": "rh_surface_i16_v1",
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
                        product_config=products_cfg[variable],
                        grid_meta=grid_meta,
                    )

            result_first = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=variables,
                products=_product_specs(products_cfg),
            )
            self.assertTrue(result_first.ready)
            self.assertFalse(result_first.already_published)

            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))
            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri(model_id="gfs")).decode("utf-8"))

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
                f"fields/gfs/{cycle}/000/tmp_surface.scalar.i16.bin",
            )
            self.assertEqual(
                cycle_manifest["frames"]["003"]["rh_surface"]["path"],
                f"fields/gfs/{cycle}/003/rh_surface.scalar.i16.bin",
            )
            self.assertEqual(latest_manifest, cycle_manifest)

            for fhour in fhours:
                for variable in variables:
                    frame = cycle_manifest["frames"][fhour][variable]
                    self.assertEqual(frame["byte_length"], int(grid_meta["nx"]) * int(grid_meta["ny"]) * 2)
                    payload_uri = ap.output_scalar_payload_uri(
                        item=WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
                    )
                    payload_bytes = gzip.decompress(store.read_bytes(uri=payload_uri))
                    self.assertEqual(len(payload_bytes), frame["byte_length"])
                    self.assertEqual(hashlib.sha256(payload_bytes).hexdigest(), frame["sha256"])

            result_second = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=variables,
                products=_product_specs(products_cfg),
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
            products_cfg = {
                "tmp_surface": _minimal_layer_config(),
            }

            ctx = ExecutionContext(model_id="gfs", artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
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
                product_config=products_cfg["tmp_surface"],
                grid_meta=grid_meta,
            )

            run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=variables,
                products=_product_specs(products_cfg),
                scalar_variable_groups=[
                    _scalar_group(
                        group_id="temperature",
                        label="Temperature",
                        default_variable="tmp_surface",
                        variables=["tmp_surface"],
                    ),
                ],
            )
            first_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))

            run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=variables,
                products=_product_specs(products_cfg),
                scalar_variable_groups=[
                    _scalar_group(
                        group_id="layers",
                        label="Layers",
                        default_variable="tmp_surface",
                        variables=["tmp_surface"],
                    ),
                ],
            )
            second_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))

            self.assertNotEqual(first_manifest["revision"], second_manifest["revision"])
            self.assertEqual(second_manifest["scalar_variable_groups"][0]["id"], "layers")

    def test_publish_writes_temperature_piecewise_encoding_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-temp-piecewise-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": {
                    **_minimal_layer_config(),
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "valid_min": -35.0,
                    "valid_max": 50.0,
                    "source_transform": "identity",
                    "encoding": {
                        "id": "tmp_surface_i8_temp_c_piecewise_v1",
                        "format": "scalar-i8-temp-c-piecewise-v1",
                        "dtype": "int8",
                        "byte_order": "none",
                        "nodata": -128,
                    },
                },
            }

            ctx = ExecutionContext(model_id="gfs", artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
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
                product_config=products_cfg["tmp_surface"],
                grid_meta=grid_meta,
            )

            result = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=variables,
                products=_product_specs(products_cfg),
            )

            self.assertTrue(result.ready)
            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))
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
                f"fields/gfs/{cycle}/000/tmp_surface.scalar.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["frames"]["000"]["tmp_surface"]["byte_length"],
                int(grid_meta["nx"]) * int(grid_meta["ny"]),
            )

    def test_publish_writes_packed_cloud_component_scalar_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-cloud-components-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            variables = ("cloud_layers",)
            products_cfg = {
                "cloud_layers": _cloud_layers_config(),
            }

            ctx = ExecutionContext(model_id="gfs", artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()
            cell_count = int(grid_meta["nx"]) * int(grid_meta["ny"])
            _write_packed_cloud_scalar_marker(
                store=store,
                ap=ap,
                cycle=cycle,
                fhour="000",
                variable="cloud_layers",
                source_values_by_component={
                    "low": [0.0 for _ in range(cell_count)],
                    "medium": [50.0 for _ in range(cell_count)],
                    "high": [100.0 for _ in range(cell_count)],
                },
                product_config=products_cfg["cloud_layers"],
                grid_meta=grid_meta,
            )

            result = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=variables,
                products=_product_specs(products_cfg),
                scalar_variable_groups=[
                    _scalar_group(
                        group_id="clouds",
                        label="Clouds",
                        default_variable="cloud_layers",
                        variables=["cloud_layers"],
                    ),
                ],
            )

            self.assertTrue(result.ready)
            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))
            encoding = cycle_manifest["encodings"]["cloud_layers_i8_5pct_components_v1"]
            self.assertEqual(
                encoding,
                {
                    "format": "scalar-i8-linear-components-v1",
                    "dtype": "int8",
                    "byte_order": "none",
                    "nodata": -128,
                    "scale": 5.0,
                    "offset": 0.0,
                    "decode_formula": "value = stored * scale + offset",
                    "components": ["low", "medium", "high"],
                    "component_count": 3,
                    "component_order": "low_medium_high",
                },
            )
            self.assertEqual(cycle_manifest["variable_meta"]["cloud_layers"]["kind"], "scalar")
            self.assertEqual(
                cycle_manifest["frames"]["000"]["cloud_layers"]["path"],
                f"fields/gfs/{cycle}/000/cloud_layers.scalar.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["frames"]["000"]["cloud_layers"]["byte_length"],
                cell_count * 3,
            )

    def test_publish_does_not_promote_older_cycle_over_newer_latest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-monotonic-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            fhours = ("000",)
            cycle_old = "2026041100"
            cycle_new = "2026041200"
            scalar_variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": _minimal_layer_config(),
            }

            ctx = ExecutionContext(model_id="gfs", artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
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
                    product_config=products_cfg["tmp_surface"],
                    grid_meta=grid_meta,
                )

            result_new = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle_new,
                product_ids=scalar_variables,
                products=_product_specs(products_cfg),
            )
            self.assertTrue(result_new.ready)

            result_old = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle_old,
                product_ids=scalar_variables,
                products=_product_specs(products_cfg),
            )
            self.assertTrue(result_old.ready)

            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri(model_id="gfs")).decode("utf-8"))
            old_cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle_old)).decode("utf-8"))
            new_cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle_new)).decode("utf-8"))
            self.assertEqual(latest_manifest, new_cycle_manifest)
            self.assertNotEqual(latest_manifest["cycle"], old_cycle_manifest["cycle"])

    def test_republish_same_cycle_refreshes_latest_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-refresh-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            scalar_variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": _minimal_layer_config(),
            }

            ctx = ExecutionContext(model_id="gfs", artifact_root_uri=artifact_root_uri, forecast_hours=fhours)
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
                product_config=products_cfg["tmp_surface"],
                grid_meta=grid_meta,
            )

            result_first = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=scalar_variables,
                products=_product_specs(products_cfg),
            )
            self.assertTrue(result_first.ready)
            initial_latest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri(model_id="gfs")).decode("utf-8"))

            _write_json(
                ap.manifest_latest_uri(model_id="gfs"),
                {
                    "cycle": "2026041000",
                    "generated_at": "2026-04-10T00:00:00+00:00",
                    "revision": "stale",
                },
            )

            result_second = run_publish(
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=scalar_variables,
                products=_product_specs(products_cfg),
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

            refreshed_latest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri(model_id="gfs")).decode("utf-8"))
            self.assertEqual(refreshed_latest, initial_latest)

    def test_publish_writes_vector_only_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-vector-only-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041200"
            fhours = ("000", "003")
            vector_variables = ("wind10m_uv",)

            ctx = ExecutionContext(
                model_id="gfs",
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
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=vector_variables,
                products=_product_specs({"wind10m_uv": _wind_product_config()}),
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))
            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri(model_id="gfs")).decode("utf-8"))
            self.assertEqual(cycle_manifest["scalar_variables"], [])
            self.assertEqual(cycle_manifest["vector_variables"], ["wind10m_uv"])
            self.assertEqual(latest_manifest, cycle_manifest)
            self.assertEqual(
                cycle_manifest["frames"]["000"]["wind10m_uv"]["path"],
                f"fields/gfs/{cycle}/000/wind10m_uv.vector.i8.bin",
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
                model_id="gfs",
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            )

            products_cfg = {
                "tmp_surface": _minimal_layer_config(),
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
                    product_config=products_cfg["tmp_surface"],
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
                model_label="GFS",
                ctx=ctx,
                cycle=cycle,
                product_ids=scalar_variables + vector_variables,
                products=_product_specs({**products_cfg, "wind10m_uv": _wind_product_config()}),
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))
            latest_manifest = json.loads(store.read_bytes(uri=ap.manifest_latest_uri(model_id="gfs")).decode("utf-8"))
            self.assertEqual(cycle_manifest["version"], 4)
            self.assertEqual(cycle_manifest["contract"], "forecast-binary-v2")
            self.assertEqual(cycle_manifest["scalar_variables"], ["tmp_surface"])
            self.assertEqual(cycle_manifest["vector_variables"], ["wind10m_uv"])
            self.assertEqual(
                cycle_manifest["frames"]["000"]["wind10m_uv"]["path"],
                f"fields/gfs/{cycle}/000/wind10m_uv.vector.i8.bin",
            )
            self.assertIn("wind10m_uv_vector_i8_v1", cycle_manifest["encodings"])
            self.assertEqual(
                cycle_manifest["encodings"]["wind10m_uv_vector_i8_v1"]["component_count"],
                2,
            )
            self.assertEqual(cycle_manifest["variable_meta"]["tmp_surface"]["kind"], "scalar")
            self.assertEqual(cycle_manifest["variable_meta"]["wind10m_uv"]["kind"], "vector")
            self.assertEqual(latest_manifest, cycle_manifest)
