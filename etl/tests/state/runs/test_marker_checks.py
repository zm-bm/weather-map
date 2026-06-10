from __future__ import annotations

import json
from typing import Any

from weather_etl.state.runs.marker_checks import read_expected_success_marker

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.artifact_specs import artifact_spec
from tests.fixtures.artifacts import DEFAULT_PRODUCT_CONFIG_DIGEST
from tests.fixtures.markers import write_json
from tests.fixtures.publish import PublishFixture, publish_fixture


def test_read_expected_success_marker_accepts_valid_marker() -> None:
    with publish_fixture(prefix="weather-map-marker-check-valid-") as fx:
        fx.write_scalar_marker()

        marker, errors = _read_expected_marker(fx)

    assert marker is not None
    assert marker.artifact_id == "tmp_surface"
    assert errors == ()


def test_read_expected_success_marker_reports_missing_marker() -> None:
    with publish_fixture(prefix="weather-map-marker-check-missing-") as fx:
        marker, errors = _read_expected_marker(fx)

    assert marker is None
    assert len(errors) == 1
    assert "invalid success marker" in errors[0]
    assert "/status/tmp_surface/000._SUCCESS.json" in errors[0]


def test_read_expected_success_marker_reports_malformed_marker() -> None:
    with publish_fixture(prefix="weather-map-marker-check-malformed-") as fx:
        fx.write_scalar_marker()
        marker_payload = _stored_marker_payload(fx)
        del marker_payload["artifact"]["sha256"]
        write_json(fx.marker_uri("tmp_surface"), marker_payload)

        marker, errors = _read_expected_marker(fx)

    assert marker is None
    assert len(errors) == 1
    assert "invalid success marker" in errors[0]


def test_read_expected_success_marker_reports_identity_and_product_config_digest_mismatches() -> None:
    with publish_fixture(prefix="weather-map-marker-check-identity-") as fx:
        fx.write_scalar_marker()
        marker_payload = _stored_marker_payload(fx)
        marker_payload["frame_id"] = "003"
        marker_payload["product_config_digest"] = "sha256:" + "1" * 64
        write_json(fx.marker_uri("tmp_surface"), marker_payload)

        marker, errors = _read_expected_marker(fx)

    assert marker is not None
    assert any("success marker frame_id mismatch" in error for error in errors)
    assert any("success marker product_config_digest mismatch" in error for error in errors)


def test_read_expected_success_marker_reports_artifact_metadata_mismatches() -> None:
    with publish_fixture(prefix="weather-map-marker-check-artifact-meta-") as fx:
        fx.write_scalar_marker()
        marker_payload = _stored_marker_payload(fx)
        marker_payload["artifact"]["payload_uri"] = "file:///wrong/path.bin"
        marker_payload["artifact"]["encoding_id"] = "other"
        marker_payload["artifact"]["components"] = ["other"]
        write_json(fx.marker_uri("tmp_surface"), marker_payload)

        marker, errors = _read_expected_marker(fx)

    assert marker is not None
    assert any("artifact metadata payload_uri mismatch" in error for error in errors)
    assert any("artifact metadata encoding_id mismatch" in error for error in errors)
    assert any("artifact metadata components mismatch" in error for error in errors)


def _read_expected_marker(fx: PublishFixture):
    artifact_id = "tmp_surface"
    return read_expected_success_marker(
        artifact_repo=fx.artifacts,
        dataset_id=fx.dataset_id,
        cycle=fx.cycle,
        run_id=fx.run_id,
        frame_id=fx.frames[0],
        artifact_id=artifact_id,
        artifact=artifact_spec(artifact_id, minimal_artifact_config()),
        product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
    )


def _stored_marker_payload(fx: PublishFixture) -> dict[str, Any]:
    return json.loads(fx.store.read_bytes(uri=fx.marker_uri("tmp_surface")).decode("utf-8"))
