from __future__ import annotations

import hashlib
import json
import unittest
from unittest.mock import patch

from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.manifest.build import build_cycle_manifest
from forecast_etl.manifest.constants import (
    DATA_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from forecast_etl.manifest.pointers import CURRENT_POINTER_SCHEMA, LATEST_POINTER_SCHEMA
from forecast_etl.manifest.revision import compute_manifest_revision
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_layers_config,
    minimal_artifact_config,
    precip_rate_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config
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
            "x_wrap": "repeat",
            "y_mode": "clamp",
        },
        "encoding": {
            "id": "tmp_surface_i16_v1",
            "format": "linear-i16-v1",
            "dtype": "int16",
            "byte_order": "little",
            "nodata": -32768,
            "scale": 0.01,
            "offset": 0.0,
            "decode_formula": "value = stored * scale + offset",
        },
        "frames": {
            "000": {
                "path": f"runs/gfs/2026041100/{DEFAULT_RUN_ID}/fields/000/tmp_surface.field.i16.bin",
                "byte_length": 2,
                "sha256": "a" * 64,
            },
        },
    }


class ManifestBuildTest(unittest.TestCase):
    def test_manifest_revision_is_computed_from_manifest_object(self) -> None:
        manifest = build_cycle_manifest(
            dataset_id="gfs",
            dataset_label="GFS",
            cycle="2026041100",
            run_id=DEFAULT_RUN_ID,
            payload_root=f"runs/gfs/2026041100/{DEFAULT_RUN_ID}/fields",
            generated_at="2026-04-11T01:00:00+00:00",
            frames=("000",),
            artifacts={
                "tmp_surface": _manifest_artifact("tmp_surface"),
            },
        )

        revision = manifest["run"]["revision"]
        self.assertEqual(compute_manifest_revision(manifest), revision)

        generated_changed = json.loads(json.dumps(manifest))
        generated_changed["run"]["generated_at"] = "2026-04-11T02:00:00+00:00"
        generated_changed["run"]["revision"] = "ignored"
        self.assertEqual(compute_manifest_revision(generated_changed), revision)

        artifact_changed = json.loads(json.dumps(manifest))
        artifact_changed["artifacts"]["tmp_surface"]["parameter"] = "tmp_v2"
        self.assertNotEqual(compute_manifest_revision(artifact_changed), revision)

    def test_publish_writes_scalar_manifest_and_is_idempotent(self) -> None:
        with publish_fixture(prefix="weather-map-publish-scalar-", frames=("000", "003")) as fx:
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
                        "finite_value_range": {"min": 0, "max": 100},
                    },
                },
            }

            for frame_id in fx.frames:
                for artifact_id in artifact_ids:
                    fx.write_scalar_marker(
                        frame_id=frame_id,
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
            latest_pointer = fx.latest_pointer()
            current_pointer = fx.current_pointer()

            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schema_version"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payload_contract"], DATA_BINARY_CONTRACT)
            self.assertEqual(cycle_manifest["dataset"], {"id": "gfs", "label": "GFS"})
            self.assertEqual(cycle_manifest["run"]["cycle"], fx.cycle)
            self.assertEqual(cycle_manifest["run"]["run_id"], fx.run_id)
            self.assertEqual(cycle_manifest["run"]["payload_root"], f"runs/gfs/{fx.cycle}/{fx.run_id}/fields")
            self.assertIn("generated_at", cycle_manifest["run"])
            self.assertIn("revision", cycle_manifest["run"])
            self.assertEqual(
                cycle_manifest["frames"],
                [
                    {"id": "000", "lead_hours": 0, "valid_at": "2026-04-11T00:00:00Z"},
                    {"id": "003", "lead_hours": 3, "valid_at": "2026-04-11T03:00:00Z"},
                ],
            )
            self.assertNotIn("groups", cycle_manifest)
            self.assertEqual(set(cycle_manifest["artifacts"].keys()), set(artifact_ids))
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["kind"], "scalar")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["components"], ["value"])
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["payload_file"], "tmp_surface.field.i16.bin")
            self.assertNotIn("label", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertNotIn("valueRange", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertNotIn("temporal_kind", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertNotIn("source_interval_hours", cycle_manifest["artifacts"]["tmp_surface"])
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["grid"]["id"], "gfs_0p25_global")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["grid"]["x_wrap"], "repeat")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["grid"]["y_mode"], "clamp")
            self.assertEqual(cycle_manifest["artifacts"]["tmp_surface"]["encoding"]["byte_order"], "little")
            self.assertEqual(
                cycle_manifest["artifacts"]["rh_surface"]["encoding"]["finite_value_range"],
                {"min": 0.0, "max": 100.0},
            )
            self.assertEqual(
                cycle_manifest["artifacts"]["tmp_surface"]["frames"]["000"]["path"],
                f"runs/gfs/{fx.cycle}/{fx.run_id}/fields/000/tmp_surface.field.i16.bin",
            )
            self.assertEqual(
                cycle_manifest["artifacts"]["rh_surface"]["frames"]["003"]["path"],
                f"runs/gfs/{fx.cycle}/{fx.run_id}/fields/003/rh_surface.field.i16.bin",
            )
            self.assertEqual(latest_manifest, cycle_manifest)
            self.assertEqual(latest_pointer["schema"], LATEST_POINTER_SCHEMA)
            self.assertEqual(latest_pointer["schema_version"], 1)
            self.assertEqual(latest_pointer["dataset_id"], "gfs")
            self.assertEqual(latest_pointer["cycle"], fx.cycle)
            self.assertEqual(latest_pointer["run_id"], fx.run_id)
            self.assertEqual(latest_pointer["revision"], cycle_manifest["run"]["revision"])
            self.assertEqual(
                latest_pointer["manifest_path"],
                f"manifests/gfs/cycles/{fx.cycle}/runs/{fx.run_id}.json",
            )
            self.assertEqual(current_pointer["schema"], CURRENT_POINTER_SCHEMA)
            self.assertEqual(current_pointer["run_id"], fx.run_id)
            self.assertEqual(current_pointer["manifest_path"], latest_pointer["manifest_path"])
            self.assertFalse(
                fx.store.exists(uri=f"{fx.artifact_root_uri.rstrip('/')}/manifests/{fx.dataset_id}/{fx.cycle}.json")
            )
            self.assertEqual(
                fx.artifacts.read_run_manifest(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id),
                cycle_manifest,
            )
            self.assertTrue(
                fx.artifacts.published_marker_exists(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id)
            )
            self.assertEqual(
                fx.artifacts.read_published_marker(
                    dataset_id=fx.dataset_id,
                    cycle=fx.cycle,
                    run_id=fx.run_id,
                ).manifest_uri,
                fx.ap.public_run_manifest_uri(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id),
            )

            for frame_id in fx.frames:
                for artifact_id in artifact_ids:
                    frame = cycle_manifest["artifacts"][artifact_id]["frames"][frame_id]
                    self.assertEqual(frame["byte_length"], fx.cell_count * 2)
                    payload_bytes = fx.payload_bytes(artifact_id=artifact_id, frame_id=frame_id, dtype="int16")
                    self.assertEqual(len(payload_bytes), frame["byte_length"])
                    self.assertEqual(hashlib.sha256(payload_bytes).hexdigest(), frame["sha256"])

            result_second = fx.publish(
                artifact_ids=artifact_ids,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

    def test_publish_writes_data_manifest_when_pipeline_config_is_provided(self) -> None:
        cfg = parse_pipeline_config(minimal_pipeline_config())
        catalog = {
            "catalogVersion": "test-forecast-catalog",
            "rasterLayers": [
                {"id": "published_artifact", "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]}},
                {"id": "unsupported_artifact", "source": {"artifactId": "rh_surface", "bands": [{"id": "value"}]}},
            ],
        }

        with publish_fixture(prefix="weather-map-publish-data-manifest-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_cfg,
            )

            with patch("forecast_etl.manifest.data_manifest.load_forecast_catalog", return_value=catalog):
                result = fx.publish(
                    artifact_ids=(artifact_id,),
                    artifacts_cfg={artifact_id: artifact_cfg},
                    pipeline_config=cfg,
                )

            self.assertTrue(result.ready)
            self.assertTrue(fx.artifacts.data_manifest_exists())
            data_manifest = fx.artifacts.read_data_manifest()
            self.assertEqual(data_manifest["schema"], "weather-map.data-manifest")
            self.assertEqual(data_manifest["schema_version"], 1)
            self.assertEqual(data_manifest["payload_contract"], "field-binary-v2")
            self.assertEqual(data_manifest["catalog_version"], "test-forecast-catalog")
            self.assertNotIn("latest_cycle", data_manifest["datasets"]["gfs"])
            self.assertNotIn("latest_manifest_path", data_manifest["datasets"]["gfs"])
            latest = data_manifest["datasets"]["gfs"]["latest"]
            self.assertEqual(latest["run"]["cycle"], fx.cycle)
            self.assertEqual(latest["run"]["run_id"], fx.run_id)
            self.assertEqual(latest["run"]["payload_root"], f"runs/gfs/{fx.cycle}/{fx.run_id}/fields")
            self.assertEqual(latest["frames"][0]["id"], "000")
            self.assertNotIn("schema", latest)
            self.assertNotIn("schema_version", latest)
            self.assertNotIn("payload_contract", latest)
            latest_artifact = latest["artifacts"]["tmp_surface"]
            self.assertEqual(latest_artifact["byte_length"], fx.cell_count * 2)
            self.assertEqual(latest_artifact["payload_file"], "tmp_surface.field.i16.bin")
            self.assertNotIn("frames", latest_artifact)
            self.assertNotIn("path", latest_artifact)
            self.assertNotIn("sha256", latest_artifact)
            self.assertEqual(data_manifest["layers"]["published_artifact"]["datasets"]["gfs"]["state"], "available")
            self.assertEqual(
                data_manifest["layers"]["unsupported_artifact"]["datasets"]["gfs"]["state"],
                "unsupported",
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
            self.assertEqual(artifact["temporal_kind"], "average_rate")
            self.assertEqual(artifact["source_interval_hours"], 1.0)

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
                    "byte_order": "none",
                    "nodata": -128,
                },
            )
            self.assertEqual(
                artifact["frames"]["000"]["path"],
                f"runs/gfs/{fx.cycle}/{fx.run_id}/fields/000/tmp_surface.field.i8.bin",
            )
            self.assertEqual(
                artifact["frames"]["000"]["byte_length"],
                fx.cell_count,
            )

    def test_publish_writes_cloud_layers_vector_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-cloud-layers-") as fx:
            artifact_ids = ("cloud_layers",)
            artifacts_cfg = {
                "cloud_layers": cloud_layers_config(),
            }

            fx.write_vector_marker(
                artifact_id="cloud_layers",
                artifact_config=artifacts_cfg["cloud_layers"],
            )

            result = fx.publish(
                artifact_ids=artifact_ids,
                artifacts_cfg=artifacts_cfg,
            )

            self.assertTrue(result.ready)
            cycle_manifest = fx.cycle_manifest()
            artifact = cycle_manifest["artifacts"]["cloud_layers"]
            encoding = artifact["encoding"]
            self.assertEqual(
                encoding,
                {
                    "id": "cloud_layers_vector_i8_4pct_v1",
                    "format": "linear-i8-v1",
                    "dtype": "int8",
                    "byte_order": "none",
                    "nodata": -128,
                    "scale": 4.0,
                    "offset": 0.0,
                    "decode_formula": "value = stored * scale + offset",
                    "finite_value_range": {"min": 0.0, "max": 100.0},
                },
            )
            self.assertEqual(artifact["components"], ["low", "middle", "high"])
            self.assertEqual(artifact["kind"], "vector")
            self.assertEqual(artifact["units"], "%")
            self.assertEqual(artifact["parameter"], "cloud_layers")
            self.assertNotIn("valueRange", artifact)
            self.assertEqual(
                artifact["frames"]["000"]["path"],
                f"runs/gfs/{fx.cycle}/{fx.run_id}/fields/000/cloud_layers.field.i8.bin",
            )
            self.assertEqual(
                artifact["frames"]["000"]["byte_length"],
                fx.cell_count * 3,
            )

    def test_publish_writes_vector_only_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-vector-only-", cycle="2026041200", frames=("000", "003")) as fx:
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
                f"runs/gfs/{fx.cycle}/{fx.run_id}/fields/000/wind10m_uv.field.i8.bin",
            )

    def test_publish_includes_wind_frames_and_metadata_without_sidecars(self) -> None:
        with publish_fixture(prefix="weather-map-publish-wind-", cycle="2026041200", frames=("000", "003")) as fx:
            scalar_artifacts = ("tmp_surface",)
            vector_artifacts = ("wind10m_uv",)
            artifacts_cfg = {
                "tmp_surface": minimal_artifact_config(),
            }

            for frame_id in fx.frames:
                fx.write_scalar_marker(
                    frame_id=frame_id,
                    artifact_id="tmp_surface",
                    base=-10.0,
                    artifact_config=artifacts_cfg["tmp_surface"],
                )
                fx.write_vector_marker(frame_id=frame_id)

            result = fx.publish(
                artifact_ids=scalar_artifacts + vector_artifacts,
                artifacts_cfg={**artifacts_cfg, "wind10m_uv": wind_artifact_config()},
            )
            self.assertTrue(result.ready)
            self.assertFalse(result.already_published)

            cycle_manifest = fx.cycle_manifest()
            latest_manifest = fx.latest_manifest()
            self.assertEqual(cycle_manifest["schema"], MANIFEST_SCHEMA)
            self.assertEqual(cycle_manifest["schema_version"], MANIFEST_SCHEMA_VERSION)
            self.assertEqual(cycle_manifest["payload_contract"], DATA_BINARY_CONTRACT)
            self.assertNotIn("groups", cycle_manifest)
            self.assertEqual(list(cycle_manifest["artifacts"].keys()), ["tmp_surface", "wind10m_uv"])
            self.assertEqual(
                cycle_manifest["artifacts"]["wind10m_uv"]["frames"]["000"]["path"],
                f"runs/gfs/{fx.cycle}/{fx.run_id}/fields/000/wind10m_uv.field.i8.bin",
            )
            self.assertEqual(
                cycle_manifest["artifacts"]["wind10m_uv"]["components"],
                ["u", "v"],
            )
            self.assertEqual(latest_manifest, cycle_manifest)



if __name__ == "__main__":
    unittest.main()
