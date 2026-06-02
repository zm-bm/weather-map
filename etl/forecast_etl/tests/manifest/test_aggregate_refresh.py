from __future__ import annotations

import unittest
from unittest.mock import patch

from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.manifest.data_manifest_refresh import should_refresh_data_manifest
from forecast_etl.tests.fixtures.artifact_configs import (
    minimal_artifact_config,
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


class ManifestAggregateRefreshTest(unittest.TestCase):
    def test_older_cycle_publish_does_not_rebuild_data_manifest(self) -> None:
        with publish_fixture(prefix="weather-map-publish-older-no-data-manifest-") as fx:
            cycle_old = "2026041100"
            cycle_new = "2026041200"
            scalar_artifacts = ("tmp_surface",)
            artifacts_cfg = {
                "tmp_surface": minimal_artifact_config(),
            }
            pipeline_config = parse_pipeline_config(minimal_pipeline_config())

            for cycle_value, base in ((cycle_new, 10.0), (cycle_old, -10.0)):
                fx.write_scalar_marker(
                    cycle=cycle_value,
                    artifact_id="tmp_surface",
                    base=base,
                    artifact_config=artifacts_cfg["tmp_surface"],
                )

            with patch(
                "forecast_etl.manifest.data_manifest_refresh.publish_data_manifest",
                return_value="file:///manifest.json",
            ) as publish_data_manifest:
                result_new = fx.publish(
                    cycle=cycle_new,
                    artifact_ids=scalar_artifacts,
                    artifacts_cfg=artifacts_cfg,
                    pipeline_config=pipeline_config,
                )
                result_old = fx.publish(
                    cycle=cycle_old,
                    artifact_ids=scalar_artifacts,
                    artifacts_cfg=artifacts_cfg,
                    pipeline_config=pipeline_config,
                )

            self.assertTrue(result_new.latest_promoted)
            self.assertFalse(result_old.latest_promoted)
            self.assertEqual(publish_data_manifest.call_count, 1)

    def test_data_manifest_refresh_decision_is_independent(self) -> None:
        with publish_fixture(prefix="weather-map-publish-refresh-decision-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)

            result = fx.publish(artifact_ids=(artifact_id,), artifacts_cfg={artifact_id: artifact_cfg})
            self.assertTrue(result.ready)
            revision = fx.latest_pointer()["revision"]

            self.assertTrue(
                should_refresh_data_manifest(
                    artifacts=fx.artifacts,
                    dataset_id=fx.dataset_id,
                    cycle=fx.cycle,
                    run_id=fx.run_id,
                    revision=revision,
                    latest_promoted=True,
                )
            )
            self.assertTrue(
                should_refresh_data_manifest(
                    artifacts=fx.artifacts,
                    dataset_id=fx.dataset_id,
                    cycle=fx.cycle,
                    run_id=fx.run_id,
                    revision=revision,
                    latest_promoted=False,
                )
            )

            pipeline_config = parse_pipeline_config(minimal_pipeline_config())
            fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                pipeline_config=pipeline_config,
            )
            self.assertFalse(
                should_refresh_data_manifest(
                    artifacts=fx.artifacts,
                    dataset_id=fx.dataset_id,
                    cycle=fx.cycle,
                    run_id=fx.run_id,
                    revision=revision,
                    latest_promoted=False,
                )
            )



if __name__ == "__main__":
    unittest.main()
