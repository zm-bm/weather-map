from __future__ import annotations

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.publish import publish_fixture


def _tmp_artifact() -> tuple[str, dict]:
    return "tmp_surface", minimal_artifact_config()


def test_publish_returns_not_ready_without_validation_report() -> None:
    with publish_fixture(prefix="weather-map-publish-missing-validation-") as fx:
        artifact_id, artifact_cfg = _tmp_artifact()
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)

        result = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            auto_validate=False,
        )

        assert not result.ready
        assert "missing validation report" in result.validation_errors[0]


def test_publish_returns_not_ready_for_failed_validation_report() -> None:
    with publish_fixture(prefix="weather-map-publish-failed-validation-") as fx:
        artifact_id, artifact_cfg = _tmp_artifact()
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)
        fx.write_failed_validation(artifact_ids=(artifact_id,), error="marker mismatch")

        result = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            auto_validate=False,
        )

        assert not result.ready
        assert "validation report status is not passed" in result.validation_errors[0]


def test_publish_reports_run_selection_failures_as_run_errors() -> None:
    with publish_fixture(prefix="weather-map-publish-multiple-runs-") as fx:
        artifact_id, artifact_cfg = _tmp_artifact()
        later_run_id = "20260411T010203Z-abcdef12"
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, run_id=fx.run_id)
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, run_id=later_run_id)

        result = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
        )

        assert not result.ready
        assert result.marker_errors == ()
        assert "multiple runs found" in result.run_errors[0]
