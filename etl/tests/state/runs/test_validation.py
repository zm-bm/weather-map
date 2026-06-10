from __future__ import annotations

import json

from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.state.runs.snapshots import LoadedRunSnapshot
from weather_etl.state.runs.validation import PAYLOAD_CHECK_MODE, validate_run, validation_report_passed

from tests.fixtures.markers import write_json
from tests.fixtures.pipeline import loaded_run_snapshot, minimal_pipeline_config
from tests.fixtures.publish import publish_fixture


def _dataset(*, frame_end: int = 0):
    cfg = minimal_pipeline_config()
    cfg["datasets"]["gfs"]["workload"]["frame_end"] = frame_end
    return parse_pipeline_config(cfg).dataset("gfs")


def _snapshot(*, cycle: str, run_id: str, frame_end: int = 0) -> LoadedRunSnapshot:
    return loaded_run_snapshot(
        cycle=cycle,
        run_id=run_id,
        frame_end=frame_end,
        artifact_root_uri="file:///artifacts",
    )


def test_validate_run_passes_complete_marker_set_and_writes_report() -> None:
    with publish_fixture(prefix="weather-map-validate-pass-", frames=("000",)) as fx:
        dataset = _dataset()
        fx.write_scalar_marker()

        result = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
        )

        assert result.passed
        assert result.report["status"] == "passed"
        assert result.report["payload_check_mode"] == PAYLOAD_CHECK_MODE
        assert result.report["expected"]["marker_count"] == 1
        assert result.report["observed"]["expected_markers"] == 1
        assert fx.artifacts.validation_report_exists(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id)
        passed, errors = validation_report_passed(
            artifact_repo=fx.artifacts,
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        )
        assert passed
        assert errors == []


def test_validation_report_passed_fails_when_report_is_missing() -> None:
    with publish_fixture(prefix="weather-map-validation-report-missing-") as fx:
        passed, errors = validation_report_passed(
            artifact_repo=fx.artifacts,
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        )

    assert not passed
    assert len(errors) == 1
    assert "missing validation report" in errors[0]


def test_validation_report_passed_fails_for_identity_mismatch() -> None:
    with publish_fixture(prefix="weather-map-validation-report-identity-") as fx:
        fx.write_passing_validation(artifact_ids=("tmp_surface",))
        report = fx.artifacts.read_validation_report(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id)
        report["dataset_id"] = "icon"
        fx.artifacts.write_validation_report(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id, report=report)

        passed, errors = validation_report_passed(
            artifact_repo=fx.artifacts,
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        )

    assert not passed
    assert any("validation report dataset_id mismatch" in error for error in errors)


def test_validation_report_passed_fails_for_failed_status_with_sample_error() -> None:
    with publish_fixture(prefix="weather-map-validation-report-failed-") as fx:
        fx.write_failed_validation(artifact_ids=("tmp_surface",), error="missing marker")

        passed, errors = validation_report_passed(
            artifact_repo=fx.artifacts,
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        )

    assert not passed
    assert len(errors) == 1
    assert "validation report status is not passed" in errors[0]
    assert "missing marker" in errors[0]


def test_validation_report_passed_fails_for_malformed_report_json() -> None:
    with publish_fixture(prefix="weather-map-validation-report-malformed-") as fx:
        uri = fx.ap.validation_report_uri(dataset_id=fx.dataset_id, cycle=fx.cycle, run_id=fx.run_id)
        fx.store.write_bytes(uri=uri, data=b"{not json")

        passed, errors = validation_report_passed(
            artifact_repo=fx.artifacts,
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
        )

    assert not passed
    assert len(errors) == 1
    assert "invalid validation report" in errors[0]


def test_validate_run_fails_for_missing_and_unexpected_markers() -> None:
    with publish_fixture(prefix="weather-map-validate-missing-", frames=("000",)) as fx:
        dataset = _dataset()
        fx.write_scalar_marker(artifact_id="extra_surface")

        result = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
        )

        assert not result.passed
        assert any("missing success marker" in error for error in result.errors)
        assert any("unexpected success marker" in error for error in result.errors)
        assert result.report["status"] == "failed"


def test_validate_run_fails_for_bad_marker_schema() -> None:
    with publish_fixture(prefix="weather-map-validate-bad-schema-", frames=("000",)) as fx:
        dataset = _dataset()
        fx.write_scalar_marker()
        marker_uri = fx.marker_uri("tmp_surface")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        del marker["artifact"]["sha256"]
        write_json(marker_uri, marker)

        result = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
        )

        assert not result.passed
        assert any("invalid success marker" in error for error in result.errors)


def test_validate_run_fails_for_identity_config_and_payload_mismatch() -> None:
    with publish_fixture(prefix="weather-map-validate-identity-", frames=("000",)) as fx:
        dataset = _dataset()
        fx.write_scalar_marker()
        marker_uri = fx.marker_uri("tmp_surface")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker["frame_id"] = "003"
        marker["product_config_digest"] = "sha256:" + "1" * 64
        marker["artifact"]["payload_uri"] = "file:///wrong/path.bin"
        write_json(marker_uri, marker)

        result = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
        )

        assert not result.passed
        assert any("success marker frame_id mismatch" in error for error in result.errors)
        assert any("success marker product_config_digest mismatch" in error for error in result.errors)
        assert any("artifact metadata payload_uri mismatch" in error for error in result.errors)


def test_validate_run_fails_for_artifact_metadata_mismatch() -> None:
    with publish_fixture(prefix="weather-map-validate-artifact-meta-", frames=("000",)) as fx:
        dataset = _dataset()
        fx.write_scalar_marker()
        marker_uri = fx.marker_uri("tmp_surface")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker["artifact"]["encoding_id"] = "other"
        marker["artifact"]["components"] = ["other"]
        write_json(marker_uri, marker)

        result = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id),
        )

        assert not result.passed
        assert any("artifact metadata encoding_id mismatch" in error for error in result.errors)
        assert any("artifact metadata components mismatch" in error for error in result.errors)


def test_validate_run_fails_for_grid_mismatch_across_hours() -> None:
    with publish_fixture(prefix="weather-map-validate-grid-", frames=("000", "001")) as fx:
        dataset = _dataset(frame_end=1)
        fx.write_scalar_markers()
        marker_uri = fx.marker_uri("tmp_surface", frame_id="001")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker["artifact"]["grid"]["dx"] = 2
        write_json(marker_uri, marker)

        result = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=_snapshot(cycle=fx.cycle, run_id=fx.run_id, frame_end=1),
        )

        assert not result.passed
        assert any("grid metadata mismatch" in error for error in result.errors)
