from __future__ import annotations

import json
import unittest

from forecast_etl.manifest.marker_evidence import collect_publish_marker_evidence
from forecast_etl.tests.fixtures.artifact_configs import (
    minimal_artifact_config,
)
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID
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


class ManifestMarkerEvidenceTest(unittest.TestCase):
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
                ("frame_id", "003"),
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

    def test_publish_returns_not_ready_for_missing_run_id_marker(self) -> None:
        with publish_fixture(prefix="weather-map-publish-missing-run-id-") as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)
            marker_uri = fx.marker_uri(artifact_id)
            marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
            del marker["run_id"]
            write_json(marker_uri, marker)

            result = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
            )

            self.assertFalse(result.ready)
            self.assertIn("missing run_id", result.marker_errors[0])

    def test_publish_returns_not_ready_for_mixed_run_ids(self) -> None:
        with publish_fixture(prefix="weather-map-publish-mixed-run-id-", frames=("000", "003")) as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, frame_id="000")
            fx.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_cfg,
                frame_id="003",
                run_id="20260411T010203Z-abcdef12",
            )

            result = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
            )

            self.assertFalse(result.ready)
            self.assertIn("multiple runs found", result.marker_errors[0])

    def test_marker_evidence_reports_missing_markers(self) -> None:
        with publish_fixture(prefix="weather-map-publish-marker-evidence-", frames=("000", "003")) as fx:
            artifact_id = "tmp_surface"
            artifact_cfg = minimal_artifact_config()
            fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, frame_id="000")

            evidence = collect_publish_marker_evidence(
                artifact_repo=fx.artifacts,
                dataset_id=fx.dataset_id,
                cycle=fx.cycle,
                run_id=fx.run_id,
                frames=fx.frames,
                artifact_ids=(artifact_id,),
            )

            self.assertFalse(evidence.ready)
            self.assertEqual(len(evidence.missing_markers), 1)
            self.assertIn("/status/tmp_surface/003._SUCCESS.json", evidence.missing_markers[0])



if __name__ == "__main__":
    unittest.main()
