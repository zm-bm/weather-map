from __future__ import annotations

import unittest

from forecast_etl.manifest.pointers import LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.tests.fixtures.artifact_configs import (
    minimal_artifact_config,
)
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID
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


class ManifestPromotionTest(unittest.TestCase):
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
            self.assertTrue(result_new.latest_promoted)

            result_old = fx.publish(
                cycle=cycle_old,
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_old.ready)
            self.assertFalse(result_old.latest_promoted)

            latest_manifest = fx.latest_manifest()
            latest_pointer = fx.latest_pointer()
            old_cycle_manifest = fx.cycle_manifest(cycle=cycle_old)
            new_cycle_manifest = fx.cycle_manifest(cycle=cycle_new)
            self.assertEqual(latest_manifest, new_cycle_manifest)
            self.assertEqual(latest_pointer["schema"], LATEST_POINTER_SCHEMA)
            self.assertEqual(latest_pointer["cycle"], cycle_new)
            self.assertEqual(latest_pointer["run_id"], fx.run_id)
            self.assertEqual(fx.current_pointer(cycle=cycle_old)["cycle"], cycle_old)
            self.assertEqual(fx.current_pointer(cycle=cycle_new)["cycle"], cycle_new)
            self.assertNotEqual(latest_manifest["run"]["cycle"], old_cycle_manifest["run"]["cycle"])

    def test_publish_can_repromote_previous_run_for_same_cycle(self) -> None:
        with publish_fixture(prefix="weather-map-publish-same-cycle-rollback-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            later_run_id = "20260411T010203Z-abcdef12"

            fx.write_scalar_marker(
                artifact_id=artifact_id,
                base=-10.0,
                artifact_config=artifact_cfg,
                run_id=fx.run_id,
            )
            result_first = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                run_id=fx.run_id,
            )
            self.assertTrue(result_first.ready)
            first_revision = fx.latest_pointer()["revision"]

            fx.write_scalar_marker(
                artifact_id=artifact_id,
                base=10.0,
                artifact_config=artifact_cfg,
                run_id=later_run_id,
            )
            result_second = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                run_id=later_run_id,
            )
            self.assertTrue(result_second.ready)
            self.assertEqual(fx.latest_pointer()["run_id"], later_run_id)
            self.assertNotEqual(fx.latest_pointer()["revision"], first_revision)

            result_rollback = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                run_id=fx.run_id,
            )

            self.assertTrue(result_rollback.ready)
            self.assertTrue(result_rollback.already_published)
            self.assertEqual(fx.latest_pointer()["run_id"], fx.run_id)
            self.assertEqual(fx.latest_pointer()["revision"], first_revision)
            self.assertEqual(fx.current_pointer()["run_id"], fx.run_id)

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

            stale_manifest = {
                "run": {
                    "cycle": "2026041000",
                    "run_id": fx.run_id,
                    "payload_root": f"runs/gfs/2026041000/{fx.run_id}/fields",
                    "generated_at": "2026-04-10T00:00:00+00:00",
                    "revision": "stale",
                }
            }
            stale_uri = fx.artifacts.write_public_run_manifest(
                dataset_id="gfs",
                cycle="2026041000",
                run_id=fx.run_id,
                manifest=stale_manifest,
            )
            fx.artifacts.write_latest_pointer(
                dataset_id="gfs",
                pointer=manifest_pointer_dict(
                    schema_name=LATEST_POINTER_SCHEMA,
                    dataset_id="gfs",
                    cycle="2026041000",
                    run_id=fx.run_id,
                    revision="stale",
                    generated_at="2026-04-10T00:00:00+00:00",
                    manifest_path=fx.ap.relative_key(stale_uri),
                ),
            )

            result_second = fx.publish(
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
            )
            self.assertTrue(result_second.ready)
            self.assertTrue(result_second.already_published)

            refreshed_latest = fx.latest_manifest()
            self.assertEqual(refreshed_latest, initial_latest)
            self.assertEqual(fx.latest_pointer()["schema"], LATEST_POINTER_SCHEMA)



if __name__ == "__main__":
    unittest.main()
