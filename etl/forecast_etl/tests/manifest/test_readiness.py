from __future__ import annotations

import unittest

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


class ManifestReadinessTest(unittest.TestCase):
    def test_publish_returns_not_ready_without_validation_report(self) -> None:
        with publish_fixture(prefix="weather-map-publish-missing-validation-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)

            result = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                auto_validate=False,
            )

            self.assertFalse(result.ready)
            self.assertIn("missing validation report", result.validation_errors[0])

    def test_publish_returns_not_ready_for_failed_validation_report(self) -> None:
        with publish_fixture(prefix="weather-map-publish-failed-validation-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)
            fx.write_failed_validation(artifact_ids=(artifact_id,), error="marker mismatch")

            result = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                auto_validate=False,
            )

            self.assertFalse(result.ready)
            self.assertIn("validation report status is not passed", result.validation_errors[0])



if __name__ == "__main__":
    unittest.main()
