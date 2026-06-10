from __future__ import annotations

import json

import pytest
from weather_etl.state.manifest.publish_markers import collect_publish_markers

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.markers import write_json
from tests.fixtures.publish import publish_fixture


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    (
        ("dataset_id", "other_dataset"),
        ("cycle", "2026041200"),
        ("frame_id", "003"),
        ("artifact_id", "other_artifact"),
    ),
)
def test_publish_rejects_marker_identity_mismatch(field: str, invalid_value: str) -> None:
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
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker[field] = invalid_value
        write_json(marker_uri, marker)

        with pytest.raises(SystemExit, match=rf"Success marker {field} mismatch"):
            fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg=artifacts_cfg,
            )


def test_publish_returns_not_ready_for_missing_run_id_marker() -> None:
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

        assert not result.ready
        assert "missing run_id" in result.marker_errors[0]


def test_publish_returns_not_ready_for_mixed_run_ids() -> None:
    with publish_fixture(prefix="weather-map-publish-mixed-run-id-", frames=("000", "003")) as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, frame_id="000")
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, frame_id="003")
        marker_uri = fx.marker_uri(artifact_id, frame_id="003")
        marker = json.loads(fx.store.read_bytes(uri=marker_uri).decode("utf-8"))
        marker["run_id"] = "20260411T010203Z-abcdef12"
        write_json(marker_uri, marker)

        result = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
        )

        assert not result.ready
        assert any("success markers contain multiple run_id values" in error for error in result.marker_errors)


def test_publish_markers_report_missing_markers() -> None:
    with publish_fixture(prefix="weather-map-publish-markers-", frames=("000", "003")) as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg, frame_id="000")

        markers = collect_publish_markers(
            artifact_repo=fx.artifacts,
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            run_id=fx.run_id,
            frames=fx.frames,
            artifact_ids=(artifact_id,),
        )

        assert not markers.ready
        assert len(markers.missing_markers) == 1
        assert "/status/tmp_surface/003._SUCCESS.json" in markers.missing_markers[0]
