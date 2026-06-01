from __future__ import annotations

import json
import unittest

from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.run_validation import PAYLOAD_CHECK_MODE, validate_run, validation_report_passed
from forecast_etl.tests.fixtures.artifacts import DEFAULT_CONFIG_DIGEST, DEFAULT_RUN_ID
from forecast_etl.tests.fixtures.markers import write_json
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config
from forecast_etl.tests.fixtures.publish import publish_fixture


def _model(*, fhour_end: int = 0):
    cfg = minimal_pipeline_config()
    cfg["models"]["gfs"]["workload"]["forecast_hour_end"] = fhour_end
    return parse_pipeline_config(cfg).model("gfs")


def _snapshot() -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest=DEFAULT_CONFIG_DIGEST,
        pipeline_config_uri=f"file:///artifacts/runs/gfs/2026041100/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"file:///artifacts/runs/gfs/2026041100/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=None,  # type: ignore[arg-type]
        forecast_catalog={},
    )


class RunValidationTest(unittest.TestCase):
    def test_validate_run_passes_complete_marker_set_and_writes_report(self) -> None:
        with publish_fixture(prefix="weather-map-validate-pass-", fhours=("000",)) as fx:
            model = _model()
            fx.write_scalar_marker()

            result = validate_run(
                artifact_repo=fx.artifacts,
                model=model,
                cycle=fx.cycle,
                run_id=fx.run_id,
                snapshot=_snapshot(),
            )

            self.assertTrue(result.passed)
            self.assertEqual(result.report["status"], "passed")
            self.assertEqual(result.report["payloadCheckMode"], PAYLOAD_CHECK_MODE)
            self.assertEqual(result.report["expected"]["markerCount"], 1)
            self.assertEqual(result.report["observed"]["expectedMarkers"], 1)
            self.assertTrue(
                fx.artifacts.validation_report_exists(model_id=fx.model_id, cycle=fx.cycle, run_id=fx.run_id)
            )
            passed, errors = validation_report_passed(
                artifact_repo=fx.artifacts,
                model_id=fx.model_id,
                cycle=fx.cycle,
                run_id=fx.run_id,
            )
            self.assertTrue(passed)
            self.assertEqual(errors, [])

    def test_validate_run_fails_for_missing_and_unexpected_markers(self) -> None:
        with publish_fixture(prefix="weather-map-validate-missing-", fhours=("000",)) as fx:
            model = _model()
            fx.write_scalar_marker(artifact_id="extra_surface")

            result = validate_run(
                artifact_repo=fx.artifacts,
                model=model,
                cycle=fx.cycle,
                run_id=fx.run_id,
                snapshot=_snapshot(),
            )

            self.assertFalse(result.passed)
            self.assertTrue(any("missing success marker" in error for error in result.errors))
            self.assertTrue(any("unexpected success marker" in error for error in result.errors))
            self.assertEqual(result.report["status"], "failed")

    def test_validate_run_fails_for_bad_marker_schema(self) -> None:
        with publish_fixture(prefix="weather-map-validate-bad-schema-", fhours=("000",)) as fx:
            model = _model()
            fx.write_scalar_marker()
            marker_uri = fx.marker_uri("tmp_surface")
            marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
            del marker["artifact"]["sha256"]
            write_json(marker_uri, marker)

            result = validate_run(
                artifact_repo=fx.artifacts,
                model=model,
                cycle=fx.cycle,
                run_id=fx.run_id,
                snapshot=_snapshot(),
            )

            self.assertFalse(result.passed)
            self.assertTrue(any("invalid success marker" in error for error in result.errors))

    def test_validate_run_fails_for_identity_config_and_payload_mismatch(self) -> None:
        with publish_fixture(prefix="weather-map-validate-identity-", fhours=("000",)) as fx:
            model = _model()
            fx.write_scalar_marker()
            marker_uri = fx.marker_uri("tmp_surface")
            marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
            marker["fhour"] = "003"
            marker["config_digest"] = "sha256:" + "1" * 64
            marker["artifact"]["payload_uri"] = "file:///wrong/path.bin"
            write_json(marker_uri, marker)

            result = validate_run(
                artifact_repo=fx.artifacts,
                model=model,
                cycle=fx.cycle,
                run_id=fx.run_id,
                snapshot=_snapshot(),
            )

            self.assertFalse(result.passed)
            self.assertTrue(any("success marker fhour mismatch" in error for error in result.errors))
            self.assertTrue(any("success marker config_digest mismatch" in error for error in result.errors))
            self.assertTrue(any("artifact metadata payload_uri mismatch" in error for error in result.errors))

    def test_validate_run_fails_for_artifact_metadata_mismatch(self) -> None:
        with publish_fixture(prefix="weather-map-validate-artifact-meta-", fhours=("000",)) as fx:
            model = _model()
            fx.write_scalar_marker()
            marker_uri = fx.marker_uri("tmp_surface")
            marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
            marker["artifact"]["encoding_id"] = "other"
            marker["artifact"]["components"] = ["other"]
            write_json(marker_uri, marker)

            result = validate_run(
                artifact_repo=fx.artifacts,
                model=model,
                cycle=fx.cycle,
                run_id=fx.run_id,
                snapshot=_snapshot(),
            )

            self.assertFalse(result.passed)
            self.assertTrue(any("artifact metadata encoding_id mismatch" in error for error in result.errors))
            self.assertTrue(any("artifact metadata components mismatch" in error for error in result.errors))

    def test_validate_run_fails_for_grid_mismatch_across_hours(self) -> None:
        with publish_fixture(prefix="weather-map-validate-grid-", fhours=("000", "001")) as fx:
            model = _model(fhour_end=1)
            fx.write_scalar_markers()
            marker_uri = fx.marker_uri("tmp_surface", fhour="001")
            marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
            marker["artifact"]["grid"]["dx"] = 2
            write_json(marker_uri, marker)

            result = validate_run(
                artifact_repo=fx.artifacts,
                model=model,
                cycle=fx.cycle,
                run_id=fx.run_id,
                snapshot=_snapshot(),
            )

            self.assertFalse(result.passed)
            self.assertTrue(any("grid metadata mismatch" in error for error in result.errors))


if __name__ == "__main__":
    unittest.main()
