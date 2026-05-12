from __future__ import annotations

import hashlib
import json
import unittest

from forecast_etl.manifest.build import build_cycle_manifest
from forecast_etl.manifest.constants import (
    FORECAST_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from forecast_etl.manifest.revision import compute_manifest_revision
from forecast_etl.tests.fixtures.markers import write_json
from forecast_etl.tests.fixtures.products import (
    cloud_layers_config,
    minimal_product_config,
    precip_rate_config,
    product_group,
    wind_product_config,
)
from forecast_etl.tests.fixtures.publish import publish_fixture


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
                    "layerId": "scalar",
                    "label": "Products",
                    "defaultProductId": "tmp_surface",
                    "productIds": ["tmp_surface"],
                }
            ],
            products={
                "tmp_surface": {
                    "id": "tmp_surface",
                    "components": ["value"],
                    "style": {
                        "layerId": "scalar",
                        "paletteId": "temperature.air.c.v1",
                    },
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
        with publish_fixture(prefix="weather-map-publish-scalar-", fhours=("000", "003")) as fx:
            variables = ("tmp_surface", "rh_surface")
            products_cfg = {
                "tmp_surface": minimal_product_config(),
                "rh_surface": {
                    **minimal_product_config(),
                    "level": "surface",
                    "parameter": "rh",
                    "units": "%",
                    "valid_min": 0.0,
                    "valid_max": 100.0,
                    "style": {
                        "layer_id": "scalar",
                        "palette_id": "moisture.relative_humidity.percent.v1",
                    },
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

            for fhour in fx.fhours:
                for variable in variables:
                    fx.write_scalar_marker(
                        fhour=fhour,
                        product_id=variable,
                        base=-10.0 if variable == "tmp_surface" else 20.0,
                        product_config=products_cfg[variable],
                    )

            result_first = fx.publish(
                product_ids=variables,
                products_cfg=products_cfg,
            )
            self.assertTrue(result_first.ready)
            self.assertFalse(result_first.already_published)

            cycle_manifest = fx.cycle_manifest()
            latest_manifest = fx.latest_manifest()

            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schemaVersion"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
            self.assertEqual(cycle_manifest["model"], {"id": "gfs", "label": "GFS"})
            self.assertEqual(cycle_manifest["run"]["cycle"], fx.cycle)
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
                        "layerId": "scalar",
                        "label": "Products",
                        "defaultProductId": "tmp_surface",
                        "productIds": list(variables),
                    },
                ],
            )
            self.assertEqual(set(cycle_manifest["products"].keys()), set(variables))
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["components"], ["value"])
            self.assertEqual(
                cycle_manifest["products"]["tmp_surface"]["style"],
                {"layerId": "scalar", "paletteId": "temperature.air.c.v1"},
            )
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["valueRange"], {"min": -45.0, "max": 50.0})
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["grid"]["id"], "gfs_0p25_global")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["grid"]["xWrap"], "repeat")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["grid"]["yMode"], "clamp")
            self.assertEqual(cycle_manifest["products"]["tmp_surface"]["encoding"]["byteOrder"], "little")
            self.assertEqual(
                cycle_manifest["products"]["tmp_surface"]["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/tmp_surface.field.i16.bin",
            )
            self.assertEqual(
                cycle_manifest["products"]["rh_surface"]["frames"]["003"]["path"],
                f"fields/gfs/{fx.cycle}/003/rh_surface.field.i16.bin",
            )
            self.assertEqual(latest_manifest, cycle_manifest)

            for fhour in fx.fhours:
                for variable in variables:
                    frame = cycle_manifest["products"][variable]["frames"][fhour]
                    self.assertEqual(frame["byteLength"], fx.cell_count * 2)
                    payload_bytes = fx.payload_bytes(product_id=variable, fhour=fhour, dtype="int16")
                    self.assertEqual(len(payload_bytes), frame["byteLength"])
                    self.assertEqual(hashlib.sha256(payload_bytes).hexdigest(), frame["sha256"])

            result_second = fx.publish(
                product_ids=variables,
                products_cfg=products_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

    def test_publish_includes_product_temporal_metadata(self) -> None:
        with publish_fixture(prefix="weather-map-publish-temporal-") as fx:
            products_cfg = {
                "prate_surface": precip_rate_config(),
            }
            fx.write_scalar_marker(
                product_id="prate_surface",
                values=[0.0 for _ in range(fx.cell_count)],
                product_config=products_cfg["prate_surface"],
            )

            result = fx.publish(
                product_ids=("prate_surface",),
                products_cfg=products_cfg,
                product_groups=[
                    product_group(
                        group_id="precipitation",
                        label="Precipitation",
                        default_product="prate_surface",
                        products=["prate_surface"],
                    ),
                ],
            )

            self.assertTrue(result.ready)
            product = fx.cycle_manifest()["products"]["prate_surface"]
            self.assertEqual(product["temporalKind"], "average_rate")
            self.assertEqual(product["sourceIntervalHours"], 1.0)

    def test_publish_rejects_marker_identity_mismatch(self) -> None:
        with publish_fixture(prefix="weather-map-publish-marker-identity-") as fx:
            product_id = "tmp_surface"
            products_cfg = {
                product_id: minimal_product_config(),
            }

            fx.write_scalar_marker(
                product_id=product_id,
                product_config=products_cfg[product_id],
            )

            marker_uri = fx.marker_uri(product_id)
            valid_marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))

            for field, invalid_value in (
                ("cycle", "2026041200"),
                ("fhour", "003"),
                ("product_id", "other_product"),
            ):
                invalid_marker = json.loads(json.dumps(valid_marker))
                invalid_marker[field] = invalid_value
                write_json(marker_uri, invalid_marker)

                with self.subTest(field=field), self.assertRaisesRegex(
                    SystemExit,
                    rf"Success marker {field} mismatch",
                ):
                    fx.publish(
                        product_ids=(product_id,),
                        products_cfg=products_cfg,
                    )

            write_json(marker_uri, valid_marker)

    def test_publish_revision_includes_product_groups(self) -> None:
        with publish_fixture(prefix="weather-map-publish-groups-") as fx:
            variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": minimal_product_config(),
            }

            fx.write_scalar_marker(
                product_id="tmp_surface",
                product_config=products_cfg["tmp_surface"],
            )

            fx.publish(
                product_ids=variables,
                products_cfg=products_cfg,
                product_groups=[
                    product_group(
                        group_id="temperature",
                        label="Temperature",
                        default_product="tmp_surface",
                        products=["tmp_surface"],
                    ),
                ],
            )
            first_manifest = fx.cycle_manifest()

            fx.publish(
                product_ids=variables,
                products_cfg=products_cfg,
                product_groups=[
                    product_group(
                        group_id="alternate",
                        label="Alternate",
                        default_product="tmp_surface",
                        products=["tmp_surface"],
                    ),
                ],
            )
            second_manifest = fx.cycle_manifest()

            self.assertNotEqual(first_manifest["run"]["revision"], second_manifest["run"]["revision"])
            self.assertEqual(second_manifest["groups"][0]["id"], "alternate")

    def test_publish_revision_includes_product_style(self) -> None:
        with publish_fixture(prefix="weather-map-publish-style-") as fx:
            product_id = "tmp_surface"

            first_cfg = minimal_product_config()
            fx.write_scalar_marker(
                product_id=product_id,
                product_config=first_cfg,
            )
            fx.publish(
                product_ids=(product_id,),
                products_cfg={product_id: first_cfg},
            )
            first_manifest = fx.cycle_manifest()

            second_cfg = minimal_product_config()
            second_cfg["style"] = {
                "layer_id": "scalar",
                "palette_id": "temperature.air.c.v2",
            }
            fx.write_scalar_marker(
                product_id=product_id,
                product_config=second_cfg,
            )
            fx.publish(
                product_ids=(product_id,),
                products_cfg={product_id: second_cfg},
            )
            second_manifest = fx.cycle_manifest()

            self.assertNotEqual(first_manifest["run"]["revision"], second_manifest["run"]["revision"])
            self.assertEqual(
                second_manifest["products"]["tmp_surface"]["style"],
                {"layerId": "scalar", "paletteId": "temperature.air.c.v2"},
            )

    def test_publish_writes_temperature_piecewise_encoding_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-temp-piecewise-") as fx:
            variables = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": {
                    **minimal_product_config(),
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

            fx.write_scalar_marker(
                product_id="tmp_surface",
                values=fx.values(-35.0),
                product_config=products_cfg["tmp_surface"],
            )

            result = fx.publish(
                product_ids=variables,
                products_cfg=products_cfg,
            )

            self.assertTrue(result.ready)
            cycle_manifest = fx.cycle_manifest()
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
                f"fields/gfs/{fx.cycle}/000/tmp_surface.field.i8.bin",
            )
            self.assertEqual(
                product["frames"]["000"]["byteLength"],
                fx.cell_count,
            )

    def test_publish_writes_packed_cloud_component_scalar_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-cloud-components-") as fx:
            variables = ("cloud_layers",)
            products_cfg = {
                "cloud_layers": cloud_layers_config(),
            }

            fx.write_cloud_layers_marker(
                product_id="cloud_layers",
                product_config=products_cfg["cloud_layers"],
            )

            result = fx.publish(
                product_ids=variables,
                products_cfg=products_cfg,
                product_groups=[
                    product_group(
                        group_id="clouds",
                        label="Clouds",
                        default_product="cloud_layers",
                        products=["cloud_layers"],
                    ),
                ],
            )

            self.assertTrue(result.ready)
            cycle_manifest = fx.cycle_manifest()
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
                },
            )
            self.assertEqual(product["components"], ["low", "medium", "high"])
            self.assertEqual(product["style"], {"layerId": "scalar", "paletteId": "cloud.layers.percent.v1"})
            self.assertEqual(
                product["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/cloud_layers.field.i8.bin",
            )
            self.assertEqual(
                product["frames"]["000"]["byteLength"],
                fx.cell_count * 3,
            )

    def test_publish_does_not_promote_older_cycle_over_newer_latest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-monotonic-") as fx:
            cycle_old = "2026041100"
            cycle_new = "2026041200"
            scalar_products = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": minimal_product_config(),
            }

            for cycle_value, base in ((cycle_new, 10.0), (cycle_old, -10.0)):
                fx.write_scalar_marker(
                    cycle=cycle_value,
                    product_id="tmp_surface",
                    base=base,
                    product_config=products_cfg["tmp_surface"],
                )

            result_new = fx.publish(
                cycle=cycle_new,
                product_ids=scalar_products,
                products_cfg=products_cfg,
            )
            self.assertTrue(result_new.ready)

            result_old = fx.publish(
                cycle=cycle_old,
                product_ids=scalar_products,
                products_cfg=products_cfg,
            )
            self.assertTrue(result_old.ready)

            latest_manifest = fx.latest_manifest()
            old_cycle_manifest = fx.cycle_manifest(cycle=cycle_old)
            new_cycle_manifest = fx.cycle_manifest(cycle=cycle_new)
            self.assertEqual(latest_manifest, new_cycle_manifest)
            self.assertNotEqual(latest_manifest["run"]["cycle"], old_cycle_manifest["run"]["cycle"])

    def test_republish_same_cycle_refreshes_latest_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-refresh-") as fx:
            scalar_products = ("tmp_surface",)
            products_cfg = {
                "tmp_surface": minimal_product_config(),
            }

            fx.write_scalar_marker(
                product_id="tmp_surface",
                product_config=products_cfg["tmp_surface"],
            )

            result_first = fx.publish(
                product_ids=scalar_products,
                products_cfg=products_cfg,
            )
            self.assertTrue(result_first.ready)
            initial_latest = fx.latest_manifest()

            write_json(
                fx.ap.manifest_latest_uri(model_id="gfs"),
                {
                    "cycle": "2026041000",
                    "generated_at": "2026-04-10T00:00:00+00:00",
                    "revision": "stale",
                },
            )

            result_second = fx.publish(
                product_ids=scalar_products,
                products_cfg=products_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

            refreshed_latest = fx.latest_manifest()
            self.assertEqual(refreshed_latest, initial_latest)

    def test_publish_writes_vector_only_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-vector-only-", cycle="2026041200", fhours=("000", "003")) as fx:
            vector_products = ("wind10m_uv",)

            fx.write_vector_markers()

            result = fx.publish(
                product_ids=vector_products,
                products_cfg={"wind10m_uv": wind_product_config()},
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = fx.cycle_manifest()
            latest_manifest = fx.latest_manifest()
            self.assertEqual(cycle_manifest["groups"], [])
            self.assertEqual(list(cycle_manifest["products"].keys()), ["wind10m_uv"])
            self.assertEqual(cycle_manifest["products"]["wind10m_uv"]["components"], ["u", "v"])
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["style"],
                {"layerId": "vector", "paletteId": "wind.vector.mps.v1"},
            )
            self.assertEqual(latest_manifest, cycle_manifest)
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/wind10m_uv.field.i8.bin",
            )

    def test_publish_includes_wind_frames_and_metadata_without_sidecars(self) -> None:
        with publish_fixture(prefix="weather-map-publish-wind-", cycle="2026041200", fhours=("000", "003")) as fx:
            scalar_products = ("tmp_surface",)
            vector_products = ("wind10m_uv",)
            products_cfg = {
                "tmp_surface": minimal_product_config(),
            }

            for fhour in fx.fhours:
                fx.write_scalar_marker(
                    fhour=fhour,
                    product_id="tmp_surface",
                    base=-10.0,
                    product_config=products_cfg["tmp_surface"],
                )
                fx.write_vector_marker(fhour=fhour)

            result = fx.publish(
                product_ids=scalar_products + vector_products,
                products_cfg={**products_cfg, "wind10m_uv": wind_product_config()},
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = fx.cycle_manifest()
            latest_manifest = fx.latest_manifest()
            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schemaVersion"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
            self.assertEqual(cycle_manifest["groups"][0]["productIds"], ["tmp_surface"])
            self.assertEqual(list(cycle_manifest["products"].keys()), ["tmp_surface", "wind10m_uv"])
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/wind10m_uv.field.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["products"]["wind10m_uv"]["components"],
                ["u", "v"],
            )
            self.assertEqual(latest_manifest, cycle_manifest)
