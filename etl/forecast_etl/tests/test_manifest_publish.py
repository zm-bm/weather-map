from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from forecast_etl.config.load import load_pipeline_config
from forecast_etl.manifest.build import build_cycle_manifest
from forecast_etl.manifest.constants import (
    FORECAST_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from forecast_etl.manifest.revision import compute_manifest_revision
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_cover_config,
    minimal_artifact_config,
    precip_rate_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.markers import write_json
from forecast_etl.tests.fixtures.publish import publish_fixture


def _manifest_artifact(artifact_id: str, *, parameter: str = "tmp") -> dict:
    return {
        "id": artifact_id,
        "kind": "scalar",
        "units": "C",
        "parameter": parameter,
        "level": "surface",
        "components": ["value"],
        "grid": {
            "id": "gfs_0p25_global",
            "crs": "EPSG:4326",
            "nx": 1,
            "ny": 1,
            "lon0": 0,
            "lat0": 0,
            "dx": 1,
            "dy": 1,
            "origin": "cell_center",
            "layout": "row_major",
            "xWrap": "repeat",
            "yMode": "clamp",
        },
        "encoding": {
            "id": "tmp_surface_i16_v1",
            "format": "linear-i16-v1",
            "dtype": "int16",
            "byteOrder": "little",
            "nodata": -32768,
            "scale": 0.01,
            "offset": 0.0,
            "decodeFormula": "value = stored * scale + offset",
        },
        "frames": {
            "000": {
                "path": "fields/gfs/2026041100/000/tmp_surface.field.i16.bin",
                "byteLength": 2,
                "sha256": "a" * 64,
            },
        },
    }


class PublishManifestTest(unittest.TestCase):
    def test_manifest_revision_is_computed_from_manifest_object(self) -> None:
        manifest = build_cycle_manifest(
            model_id="gfs",
            model_label="GFS",
            cycle="2026041100",
            generated_at="2026-04-11T01:00:00+00:00",
            fhours=("000",),
            artifacts={
                "tmp_surface": _manifest_artifact("tmp_surface"),
            },
        )

        revision = manifest["run"]["revision"]
        self.assertEqual(compute_manifest_revision(manifest), revision)

        generated_changed = json.loads(json.dumps(manifest))
        generated_changed["run"]["generatedAt"] = "2026-04-11T02:00:00+00:00"
        generated_changed["run"]["revision"] = "ignored"
        self.assertEqual(compute_manifest_revision(generated_changed), revision)

        artifact_changed = json.loads(json.dumps(manifest))
        artifact_changed["artifacts"]["tmp_surface"]["parameter"] = "tmp_v2"
        self.assertNotEqual(compute_manifest_revision(artifact_changed), revision)

    def test_publish_writes_scalar_manifest_and_is_idempotent(self) -> None:
        with publish_fixture(prefix="weather-map-publish-scalar-", fhours=("000", "003")) as fx:
            artifact_ids = ("tmp_surface", "rh_surface")
            artifacts_cfg = {
                "tmp_surface": minimal_artifact_config(),
                "rh_surface": {
                    **minimal_artifact_config(),
                    "level": "surface",
                    "parameter": "rh",
                    "units": "%",
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
                for artifact_id in artifact_ids:
                    fx.write_scalar_marker(
                        fhour=fhour,
                        artifact_id=artifact_id,
                        base=-10.0 if artifact_id == "tmp_surface" else 20.0,
                        artifact_config=artifacts_cfg[artifact_id],
                    )

            result_first = fx.publish(
                artifact_ids=artifact_ids,
                artifacts_cfg=artifacts_cfg,
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
            self.assertNotIn("groups", cycle_manifest)
            self.assertEqual(set(cycle_manifest["artifacts"].keys()), set(artifact_ids))
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["kind"], "scalar")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["components"], ["value"])
            self.assertNotIn("label", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertNotIn("valueRange", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertNotIn("temporalKind", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertNotIn("sourceIntervalHours", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["grid"]["id"], "gfs_0p25_global")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["grid"]["xWrap"], "repeat")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["grid"]["yMode"], "clamp")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["encoding"]["byteOrder"], "little")
            self.assertEqual(
                cycle_manifest["artifacts"]["tmp_surface"]["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/tmp_surface.field.i16.bin",
            )
            self.assertEqual(
                cycle_manifest["artifacts"]["rh_surface"]["frames"]["003"]["path"],
                f"fields/gfs/{fx.cycle}/003/rh_surface.field.i16.bin",
            )
            self.assertEqual(latest_manifest, cycle_manifest)

            for fhour in fx.fhours:
                for artifact_id in artifact_ids:
                    frame = cycle_manifest["artifacts"][artifact_id]["frames"][fhour]
                    self.assertEqual(frame["byteLength"], fx.cell_count * 2)
                    payload_bytes = fx.payload_bytes(artifact_id=artifact_id, fhour=fhour, dtype="int16")
                    self.assertEqual(len(payload_bytes), frame["byteLength"])
                    self.assertEqual(hashlib.sha256(payload_bytes).hexdigest(), frame["sha256"])

            result_second = fx.publish(
                artifact_ids=artifact_ids,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

    def test_publish_writes_availability_index_when_pipeline_config_is_provided(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        cfg = load_pipeline_config(
            (repo_root / "config" / "pipeline" / "base.json").as_uri(),
            overlay_uri=(repo_root / "config" / "pipeline" / "local.json").as_uri(),
        )

        with publish_fixture(prefix="weather-map-publish-availability-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_cfg,
            )

            result = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                pipeline_config=cfg,
            )

            self.assertTrue(result.ready)
            self.assertTrue(fx.artifacts.availability_index_exists())
            availability_index = fx.artifacts.read_availability_index()
            self.assertEqual(availability_index["schema"], "weather-map-model-layer-availability-index")
            self.assertEqual(availability_index["schemaVersion"], 2)
            self.assertNotIn("latestCycle", availability_index["models"]["gfs"])
            self.assertNotIn("latestManifestPath", availability_index["models"]["gfs"])
            latest = availability_index["models"]["gfs"]["latest"]
            self.assertEqual(latest["run"]["cycle"], fx.cycle)
            self.assertEqual(latest["times"][0]["id"], "000")
            latest_artifact = latest["artifacts"]["tmp_surface"]
            self.assertEqual(latest_artifact["byteLength"], fx.cell_count * 2)
            self.assertNotIn("frames", latest_artifact)
            self.assertNotIn("path", latest_artifact)
            self.assertNotIn("sha256", latest_artifact)
            self.assertEqual(availability_index["layers"]["temperature"]["models"]["gfs"]["state"], "available")
            self.assertEqual(
                availability_index["layers"]["visibility"]["models"]["gfs"]["state"],
                "temporarily_unavailable",
            )
            self.assertNotIn("groups", fx.cycle_manifest())

    def test_publish_includes_artifact_temporal_metadata(self) -> None:
        with publish_fixture(prefix="weather-map-publish-temporal-") as fx:
            artifacts_cfg = {
                "prate_surface": precip_rate_config(),
            }
            fx.write_scalar_marker(
                artifact_id="prate_surface",
                values=[0.0 for _ in range(fx.cell_count)],
                artifact_config=artifacts_cfg["prate_surface"],
            )

            result = fx.publish(
                artifact_ids=("prate_surface",),
                artifacts_cfg=artifacts_cfg,
            )

            self.assertTrue(result.ready)
            artifact = fx.cycle_manifest()["artifacts"]["prate_surface"]
            self.assertEqual(artifact["temporalKind"], "average_rate")
            self.assertEqual(artifact["sourceIntervalHours"], 1.0)

    def test_publish_rejects_marker_identity_mismatch(self) -> None:
        with publish_fixture(prefix="weather-map-publish-marker-identity-") as fx:
            artifact_id = "tmp_surface"
            artifacts_cfg = {
                artifact_id: minimal_artifact_config(),
            }

            fx.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifacts_cfg[artifact_id],
            )

            marker_uri = fx.marker_uri(artifact_id)
            valid_marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))

            for field, invalid_value in (
                ("cycle", "2026041200"),
                ("fhour", "003"),
                ("artifact_id", "other_artifact"),
            ):
                invalid_marker = json.loads(json.dumps(valid_marker))
                invalid_marker[field] = invalid_value
                write_json(marker_uri, invalid_marker)

                with self.subTest(field=field), self.assertRaisesRegex(
                    SystemExit,
                    rf"Success marker {field} mismatch",
                ):
                    fx.publish(
                        artifact_ids=(artifact_id,),
                        artifacts_cfg=artifacts_cfg,
                    )

            write_json(marker_uri, valid_marker)

    def test_publish_rejects_marker_presentation_fields(self) -> None:
        with publish_fixture(prefix="weather-map-publish-presentation-marker-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_cfg,
            )
            marker_uri = fx.marker_uri(artifact_id)
            marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
            marker["artifact"]["unexpected_presentation_field"] = "legacy"
            write_json(marker_uri, marker)

            with self.assertRaisesRegex(SystemExit, "unexpected_presentation_field"):
                fx.publish(
                    artifact_ids=(artifact_id,),
                    artifacts_cfg={artifact_id: artifact_cfg},
                )

    def test_publish_writes_temperature_piecewise_encoding_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-temp-piecewise-") as fx:
            artifact_ids = ("tmp_surface",)
            artifacts_cfg = {
                "tmp_surface": {
                    **minimal_artifact_config(),
                    "parameter": "tmp",
                    "level": "surface",
                    "units": "C",
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
                artifact_id="tmp_surface",
                values=fx.values(-35.0),
                artifact_config=artifacts_cfg["tmp_surface"],
            )

            result = fx.publish(
                artifact_ids=artifact_ids,
                artifacts_cfg=artifacts_cfg,
            )

            self.assertTrue(result.ready)
            cycle_manifest = fx.cycle_manifest()
            artifact = cycle_manifest["artifacts"]["tmp_surface"]
            encoding = artifact["encoding"]
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
                artifact["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/tmp_surface.field.i8.bin",
            )
            self.assertEqual(
                artifact["frames"]["000"]["byteLength"],
                fx.cell_count,
            )

    def test_publish_writes_cloud_cover_scalar_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-cloud-cover-") as fx:
            artifact_ids = ("low_clouds",)
            artifacts_cfg = {
                "low_clouds": cloud_cover_config(),
            }

            fx.write_scalar_marker(
                artifact_id="low_clouds",
                artifact_config=artifacts_cfg["low_clouds"],
                values=fx.values(10.0),
            )

            result = fx.publish(
                artifact_ids=artifact_ids,
                artifacts_cfg=artifacts_cfg,
            )

            self.assertTrue(result.ready)
            cycle_manifest = fx.cycle_manifest()
            artifact = cycle_manifest["artifacts"]["low_clouds"]
            encoding = artifact["encoding"]
            self.assertEqual(
                encoding,
                {
                    "id": "low_clouds_i8_1pct_v1",
                    "format": "linear-i8-v1",
                    "dtype": "int8",
                    "byteOrder": "none",
                    "nodata": -128,
                    "scale": 1.0,
                    "offset": 50.0,
                    "decodeFormula": "value = stored * scale + offset",
                },
            )
            self.assertEqual(artifact["components"], ["value"])
            self.assertEqual(artifact["kind"], "scalar")
            self.assertNotIn("valueRange", artifact)
            self.assertEqual(
                artifact["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/low_clouds.field.i8.bin",
            )
            self.assertEqual(
                artifact["frames"]["000"]["byteLength"],
                fx.cell_count,
            )

    def test_publish_does_not_promote_older_cycle_over_newer_latest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-monotonic-") as fx:
            cycle_old = "2026041100"
            cycle_new = "2026041200"
            scalar_artifacts = ("tmp_surface",)
            artifacts_cfg = {
                "tmp_surface": minimal_artifact_config(),
            }

            for cycle_value, base in ((cycle_new, 10.0), (cycle_old, -10.0)):
                fx.write_scalar_marker(
                    cycle=cycle_value,
                    artifact_id="tmp_surface",
                    base=base,
                    artifact_config=artifacts_cfg["tmp_surface"],
                )

            result_new = fx.publish(
                cycle=cycle_new,
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_new.ready)

            result_old = fx.publish(
                cycle=cycle_old,
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_old.ready)

            latest_manifest = fx.latest_manifest()
            old_cycle_manifest = fx.cycle_manifest(cycle=cycle_old)
            new_cycle_manifest = fx.cycle_manifest(cycle=cycle_new)
            self.assertEqual(latest_manifest, new_cycle_manifest)
            self.assertNotEqual(latest_manifest["run"]["cycle"], old_cycle_manifest["run"]["cycle"])

    def test_republish_same_cycle_refreshes_latest_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-refresh-") as fx:
            scalar_artifacts = ("tmp_surface",)
            artifacts_cfg = {
                "tmp_surface": minimal_artifact_config(),
            }

            fx.write_scalar_marker(
                artifact_id="tmp_surface",
                artifact_config=artifacts_cfg["tmp_surface"],
            )

            result_first = fx.publish(
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
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
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

            refreshed_latest = fx.latest_manifest()
            self.assertEqual(refreshed_latest, initial_latest)

    def test_publish_writes_vector_only_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-vector-only-", cycle="2026041200", fhours=("000", "003")) as fx:
            vector_artifacts = ("wind10m_uv",)

            fx.write_vector_markers()

            result = fx.publish(
                artifact_ids=vector_artifacts,
                artifacts_cfg={"wind10m_uv": wind_artifact_config()},
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = fx.cycle_manifest()
            latest_manifest = fx.latest_manifest()
            self.assertNotIn("groups", cycle_manifest)
            self.assertEqual(list(cycle_manifest["artifacts"].keys()), ["wind10m_uv"])
            self.assertEqual(cycle_manifest["artifacts"]["wind10m_uv"]["kind"], "vector")
            self.assertEqual(cycle_manifest["artifacts"]["wind10m_uv"]["components"], ["u", "v"])
            self.assertEqual(latest_manifest, cycle_manifest)
            self.assertEqual(
                cycle_manifest["artifacts"]["wind10m_uv"]["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/wind10m_uv.field.i8.bin",
            )

    def test_publish_includes_wind_frames_and_metadata_without_sidecars(self) -> None:
        with publish_fixture(prefix="weather-map-publish-wind-", cycle="2026041200", fhours=("000", "003")) as fx:
            scalar_artifacts = ("tmp_surface",)
            vector_artifacts = ("wind10m_uv",)
            artifacts_cfg = {
                "tmp_surface": minimal_artifact_config(),
            }

            for fhour in fx.fhours:
                fx.write_scalar_marker(
                    fhour=fhour,
                    artifact_id="tmp_surface",
                    base=-10.0,
                    artifact_config=artifacts_cfg["tmp_surface"],
                )
                fx.write_vector_marker(fhour=fhour)

            result = fx.publish(
                artifact_ids=scalar_artifacts + vector_artifacts,
                artifacts_cfg={**artifacts_cfg, "wind10m_uv": wind_artifact_config()},
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = fx.cycle_manifest()
            latest_manifest = fx.latest_manifest()
            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schemaVersion"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
            self.assertNotIn("groups", cycle_manifest)
            self.assertEqual(list(cycle_manifest["artifacts"].keys()), ["tmp_surface", "wind10m_uv"])
            self.assertEqual(
                cycle_manifest["artifacts"]["wind10m_uv"]["frames"]["000"]["path"],
                f"fields/gfs/{fx.cycle}/000/wind10m_uv.field.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["artifacts"]["wind10m_uv"]["components"],
                ["u", "v"],
            )
            self.assertEqual(latest_manifest, cycle_manifest)
