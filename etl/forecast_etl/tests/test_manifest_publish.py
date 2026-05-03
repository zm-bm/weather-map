from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.config.schema import ExecutionContext
from forecast_etl.manifest.build import build_cycle_manifest
from forecast_etl.manifest.constants import (
    FORECAST_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from forecast_etl.manifest.publish import run_publish
from forecast_etl.manifest.revision import compute_manifest_revision
from forecast_etl.stores import make_store
from forecast_etl.tests.product_test_helpers import (
    _cloud_layers_config,
    _grid_meta_fixture,
    _minimal_product_config,
    _product_group,
    _product_specs,
    _wind_product_config,
    _write_cloud_layers_marker,
    _write_json,
    _write_scalar_marker,
    _write_vector_marker,
)


class PublishManifestTest(unittest.TestCase):
    def test_manifest_revision_is_computed_from_manifest_object(self) -> None:
        manifest = build_cycle_manifest(
            model_id="gfs",
            model_label="GFS",
            cycle="2026041100",
            generated_at="2026-04-11T01:00:00+00:00",
            fhours=("000",),
            product_groups=[
                {
                    "id": "products",
                    "kind": "scalar",
                    "label": "Products",
                    "defaultProductId": "tmp_surface",
                    "productIds": ["tmp_surface"],
                }
            ],
            products={
                "tmp_surface": {
                    "id": "tmp_surface",
                    "kind": "scalar",
                    "label": "Temperature",
                }
            },
        )

        revision = manifest["run"]["revision"]
        self.assertEqual(compute_manifest_revision(manifest), revision)

        generated_changed = json.loads(json.dumps(manifest))
        generated_changed["run"]["generatedAt"] = "2026-04-11T02:00:00+00:00"
        generated_changed["run"]["revision"] = "ignored"
        self.assertEqual(compute_manifest_revision(generated_changed), revision)

        product_changed = json.loads(json.dumps(manifest))
        product_changed["products"]["tmp_surface"]["label"] = "Updated temperature"
        self.assertNotEqual(compute_manifest_revision(product_changed), revision)

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
                "tmp_surface": _minimal_product_config(),
                "rh_surface": {
                    **_minimal_product_config(),
                    "level": "surface",
                    "parameter": "rh",
                    "units": "%",
                    "valid_min": 0.0,
                    "valid_max": 100.0,
                    "encoding": {
                        "id": "rh_surface_i16_v1",
                        "format": "linear-i16-v1",
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

            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schemaVersion"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
            self.assertEqual(cycle_manifest["model"], {"id": "gfs", "label": "GFS"})
            self.assertEqual(cycle_manifest["run"]["cycle"], cycle)
            self.assertIn("generatedAt", cycle_manifest["run"])
            self.assertIn("revision", cycle_manifest["run"])
            self.assertEqual(
                cycle_manifest["times"],
                [
                    {"id": "000", "leadHours": 0, "validAt": "2026-04-11T00:00:00Z"},
                    {"id": "003", "leadHours": 3, "validAt": "2026-04-11T03:00:00Z"},
                ],
            )
            self.assertEqual(
                cycle_manifest["groups"],
                [
                    {
                        "id": "products",
                        "kind": "scalar",
                        "label": "Products",
                        "defaultProductId": "tmp_surface",
                        "productIds": list(variables),
                    },
                ],
            )
            self.assertNotIn("version", cycle_manifest)
            self.assertNotIn("contract", cycle_manifest)
            self.assertNotIn("scalar_variables", cycle_manifest)
            self.assertNotIn("vector_variables", cycle_manifest)
            self.assertNotIn("frames", cycle_manifest)
            self.assertNotIn("encodings", cycle_manifest)
            self.assertNotIn("grids", cycle_manifest)
            self.assertNotIn("variable_meta", cycle_manifest)
            self.assertNotIn("variables", cycle_manifest)
            self.assertEqual(set(cycle_manifest["products"].keys()), set(variables))
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["kind"], "scalar")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["valueRange"], {"min": -45.0, "max": 50.0})
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["grid"]["id"], "gfs_0p25_global")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["grid"]["xWrap"], "repeat")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["grid"]["yMode"], "clamp")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["encoding"]["byteOrder"], "little")
            self.assertEqual(
                cycle_manifest["products"]["tmp_surface"]["frames"]["000"]["path"],
                f"fields/gfs/{cycle}/000/tmp_surface.scalar.i16.bin",
            )
            self.assertEqual(
                cycle_manifest["products"]["rh_surface"]["frames"]["003"]["path"],
                f"fields/gfs/{cycle}/003/rh_surface.scalar.i16.bin",
            )
            self.assertEqual(latest_manifest, cycle_manifest)

            for fhour in fhours:
                for variable in variables:
                    frame = cycle_manifest["products"][variable]["frames"][fhour]
                    self.assertEqual(frame["byteLength"], int(grid_meta["nx"]) * int(grid_meta["ny"]) * 2)
                    payload_uri = ap.output_scalar_payload_uri(
                        item=WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable, source_uri="file:///dev/null")
                    )
                    payload_bytes = gzip.decompress(store.read_bytes(uri=payload_uri))
                    self.assertEqual(len(payload_bytes), frame["byteLength"])
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

    def test_publish_rejects_marker_identity_mismatch(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-marker-identity-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhour = "000"
            product_id = "tmp_surface"
            products_cfg = {
                product_id: _minimal_product_config(),
            }

            ctx = ExecutionContext(model_id="gfs", artifact_root_uri=artifact_root_uri, forecast_hours=(fhour,))
            ap = ArtifactPaths(artifact_root_uri)
            store = make_store()
            grid_meta = _grid_meta_fixture()
            _write_scalar_marker(
                store=store,
                ap=ap,
                cycle=cycle,
                fhour=fhour,
                variable=product_id,
                source_values=[float(i) for i in range(int(grid_meta["nx"]) * int(grid_meta["ny"]))],
                product_config=products_cfg[product_id],
                grid_meta=grid_meta,
            )

            marker_uri = ap.success_marker_uri_parts(
                model_id="gfs",
                cycle=cycle,
                fhour=fhour,
                product_id=product_id,
            )
            valid_marker = json.loads(store.read_bytes(uri=marker_uri).decode("utf-8"))

            for field, invalid_value in (
                ("cycle", "2026041200"),
                ("fhour", "003"),
                ("product_id", "other_product"),
            ):
                invalid_marker = json.loads(json.dumps(valid_marker))
                invalid_marker[field] = invalid_value
                _write_json(marker_uri, invalid_marker)

                with self.subTest(field=field), self.assertRaisesRegex(
                    SystemExit,
                    rf"Success marker {field} mismatch",
                ):
                    run_publish(
                        model_label="GFS",
                        ctx=ctx,
                        cycle=cycle,
                        product_ids=(product_id,),
                        products=_product_specs(products_cfg),
                    )

            _write_json(marker_uri, valid_marker)

    def test_publish_revision_includes_product_groups(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-groups-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": _minimal_product_config(),
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
                product_groups=[
                    _product_group(
                        group_id="temperature",
                        label="Temperature",
                        default_product="tmp_surface",
                        products=["tmp_surface"],
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
                product_groups=[
                    _product_group(
                        group_id="alternate",
                        label="Alternate",
                        default_product="tmp_surface",
                        products=["tmp_surface"],
                    ),
                ],
            )
            second_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))

            self.assertNotEqual(first_manifest["run"]["revision"], second_manifest["run"]["revision"])
            self.assertEqual(second_manifest["groups"][0]["id"], "alternate")

    def test_publish_writes_temperature_piecewise_encoding_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-temp-piecewise-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": {
                    **_minimal_product_config(),
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
                    "valid_min": -35.0,
                    "valid_max": 50.0,
                    "source_transform": "identity",
                    "encoding": {
                        "id": "tmp_surface_i8_temp_c_piecewise_v1",
                        "format": "temp-c-piecewise-i8-v1",
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
            product = cycle_manifest["products"]["tmp_surface"]
            encoding = product["encoding"]
            self.assertEqual(
                encoding,
                {
                    "id": "tmp_surface_i8_temp_c_piecewise_v1",
                    "format": "temp-c-piecewise-i8-v1",
                    "dtype": "int8",
                    "byteOrder": "none",
                    "nodata": -128,
                },
            )
            self.assertEqual(
                product["frames"]["000"]["path"],
                f"fields/gfs/{cycle}/000/tmp_surface.scalar.i8.bin",
            )
            self.assertEqual(
                product["frames"]["000"]["byteLength"],
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
            _write_cloud_layers_marker(
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
                product_groups=[
                    _product_group(
                        group_id="clouds",
                        label="Clouds",
                        default_product="cloud_layers",
                        products=["cloud_layers"],
                    ),
                ],
            )

            self.assertTrue(result.ready)
            cycle_manifest = json.loads(store.read_bytes(uri=ap.manifest_cycle_uri(model_id="gfs", cycle=cycle)).decode("utf-8"))
            product = cycle_manifest["products"]["cloud_layers"]
            encoding = product["encoding"]
            self.assertEqual(
                encoding,
                {
                    "id": "cloud_layers_i8_5pct_components_v1",
                    "format": "linear-i8-v1",
                    "dtype": "int8",
                    "byteOrder": "none",
                    "nodata": -128,
                    "scale": 5.0,
                    "offset": 0.0,
                    "decodeFormula": "value = stored * scale + offset",
                    "components": ["low", "medium", "high"],
                },
            )
            self.assertEqual(product["kind"], "scalar")
            self.assertEqual(
                product["frames"]["000"]["path"],
                f"fields/gfs/{cycle}/000/cloud_layers.scalar.i8.bin",
            )
            self.assertEqual(
                product["frames"]["000"]["byteLength"],
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
                "tmp_surface": _minimal_product_config(),
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
            self.assertNotEqual(latest_manifest["run"]["cycle"], old_cycle_manifest["run"]["cycle"])

    def test_republish_same_cycle_refreshes_latest_manifest(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-publish-refresh-") as td:
            out_dir = Path(td) / "out"
            artifact_root_uri = f"file://{out_dir.as_posix()}"
            cycle = "2026041100"
            fhours = ("000",)
            scalar_variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": _minimal_product_config(),
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
            self.assertEqual(cycle_manifest["groups"], [])
            self.assertEqual(list(cycle_manifest["products"].keys()), ["wind10m_uv"])
            self.assertEqual(cycle_manifest["products"]["wind10m_uv"]["kind"], "vector")
            self.assertEqual(latest_manifest, cycle_manifest)
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["frames"]["000"]["path"],
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
                "tmp_surface": _minimal_product_config(),
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
            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schemaVersion"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
            self.assertEqual(cycle_manifest["groups"][0]["productIds"], ["tmp_surface"])
            self.assertEqual(list(cycle_manifest["products"].keys()), ["tmp_surface", "wind10m_uv"])
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["frames"]["000"]["path"],
                f"fields/gfs/{cycle}/000/wind10m_uv.vector.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["encoding"]["components"],
                ["u", "v"],
            )
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["kind"], "scalar")
            self.assertEqual(cycle_manifest["products"]["wind10m_uv"]["kind"], "vector")
            self.assertEqual(latest_manifest, cycle_manifest)
