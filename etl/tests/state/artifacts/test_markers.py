from __future__ import annotations

from typing import Any

import pytest
from weather_etl.state.artifacts.markers_schema import parse_artifact_success_marker

from tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_PRODUCT_CONFIG_DIGEST,
    DEFAULT_RUN_ID,
    artifact_marker_payload,
)
from tests.fixtures.grids import grid_meta_fixture

MARKER_URI = (
    "file:///tmp/out/runs/gfs/2026041200/"
    f"{DEFAULT_RUN_ID}/status/wind10m_uv/003._SUCCESS.json"
)


def test_parse_artifact_success_marker_normalizes_artifact_payload() -> None:
    grid = grid_meta_fixture()
    marker = parse_artifact_success_marker(
        _success_marker_payload(
            artifact_id="wind10m_uv",
            artifact=artifact_marker_payload(
                payload_uri=(
                    "file:///tmp/out/runs/gfs/2026041200/"
                    f"{DEFAULT_RUN_ID}/payloads/003/wind10m_uv.i8.bin"
                ),
                byte_length=24,
                format="linear-i8-v1",
                encoding_id="wind10m_uv_vector_i8_1ms_v1",
                units="m/s",
                parameter="wind_uv",
                level="10m_above_ground",
                grid_id="gfs_0p25_global",
                grid=grid,
                components=["u", "v"],
            ),
        ),
        uri=MARKER_URI,
    )

    assert marker.artifact_id == "wind10m_uv"
    assert marker.dataset_id == "gfs"
    assert marker.run_id == DEFAULT_RUN_ID
    assert marker.code_revision == DEFAULT_CODE_REVISION
    assert marker.image_identity == DEFAULT_IMAGE_IDENTITY
    assert marker.product_config_digest == DEFAULT_PRODUCT_CONFIG_DIGEST
    assert marker.artifact.byte_length == 24
    assert marker.artifact.components == ("u", "v")
    assert marker.artifact.grid["nx"] == grid["nx"]


def test_parse_artifact_success_marker_rejects_unexpected_uri_field() -> None:
    with pytest.raises(SystemExit, match="unexpected field 'uri'"):
        parse_artifact_success_marker(
            {
                **_success_marker_payload(),
                "uri": "file:///tmp/embedded.json",
            },
            uri=MARKER_URI,
        )


def test_parse_artifact_success_marker_rejects_invalid_cycle() -> None:
    with pytest.raises(SystemExit) as raised:
        parse_artifact_success_marker(
            _success_marker_payload(cycle="20260412"),
            uri=MARKER_URI,
        )

    assert "cycle" in str(raised.value)
    assert "YYYYMMDDHH" in str(raised.value)


def test_parse_artifact_success_marker_rejects_unsafe_path_segments() -> None:
    with pytest.raises(SystemExit) as raised:
        parse_artifact_success_marker(
            _success_marker_payload(dataset_id="../gfs"),
            uri=MARKER_URI,
        )

    assert "dataset_id" in str(raised.value)
    assert "path separator" in str(raised.value)


def test_parse_artifact_success_marker_requires_artifact_payload() -> None:
    payload = _success_marker_payload()
    payload.pop("artifact")

    with pytest.raises(SystemExit) as raised:
        parse_artifact_success_marker(payload, uri=MARKER_URI)

    assert "artifact" in str(raised.value)
    assert "Field required" in str(raised.value)


def test_parse_artifact_success_marker_requires_run_id() -> None:
    payload = _success_marker_payload()
    payload.pop("run_id")

    with pytest.raises(SystemExit) as raised:
        parse_artifact_success_marker(payload, uri=MARKER_URI)

    assert "run_id" in str(raised.value)
    assert "Field required" in str(raised.value)


@pytest.mark.parametrize("value", [None, "", "unknown", "digest", "sha256:" + "z" * 64])
def test_parse_artifact_success_marker_rejects_invalid_product_config_digest(value: object) -> None:
    payload = _success_marker_payload()
    payload["product_config_digest"] = value

    with pytest.raises(SystemExit) as raised:
        parse_artifact_success_marker(payload, uri=MARKER_URI)

    assert "product_config_digest" in str(raised.value)


def test_parse_artifact_success_marker_requires_product_config_digest() -> None:
    payload = _success_marker_payload()
    payload.pop("product_config_digest")

    with pytest.raises(SystemExit) as raised:
        parse_artifact_success_marker(payload, uri=MARKER_URI)

    assert "product_config_digest" in str(raised.value)
    assert "Field required" in str(raised.value)


def _success_marker_payload(
    *,
    cycle: str = "2026041200",
    run_id: str = DEFAULT_RUN_ID,
    dataset_id: str = "gfs",
    frame_id: str = "003",
    artifact_id: str = "tmp_surface",
    artifact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "schema": "weather-map.etl-artifact-success",
        "schema_version": 2,
        "cycle": cycle,
        "run_id": run_id,
        "dataset_id": dataset_id,
        "frame_id": frame_id,
        "artifact_id": artifact_id,
        "generated_at": "2026-04-12T00:00:00Z",
        "code_revision": DEFAULT_CODE_REVISION,
        "image_identity": DEFAULT_IMAGE_IDENTITY,
        "product_config_digest": DEFAULT_PRODUCT_CONFIG_DIGEST,
        "artifact": artifact or artifact_marker_payload(),
    }
