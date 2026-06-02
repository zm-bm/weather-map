from __future__ import annotations

import unittest

from forecast_etl.artifacts.markers_schema import parse_artifact_success_marker
from forecast_etl.tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_CONFIG_DIGEST,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_RUN_ID,
    artifact_marker_payload,
)
from forecast_etl.tests.fixtures.grids import grid_meta_fixture


class ArtifactSuccessMarkerTest(unittest.TestCase):
    def test_parse_artifact_success_marker_normalizes_artifact_payload(self) -> None:
        grid = grid_meta_fixture()
        marker = parse_artifact_success_marker(
            {
                "cycle": "2026041200",
                "run_id": DEFAULT_RUN_ID,
                "dataset_id": "gfs",
                "frame_id": "003",
                "artifact_id": "wind10m_uv",
                "code_revision": DEFAULT_CODE_REVISION,
                "image_identity": DEFAULT_IMAGE_IDENTITY,
                "config_digest": DEFAULT_CONFIG_DIGEST,
                "artifact": artifact_marker_payload(
                    payload_uri=(
                        "file:///tmp/out/runs/gfs/2026041200/"
                        f"{DEFAULT_RUN_ID}/fields/003/wind10m_uv.field.i8.bin"
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
            },
            uri=(
                "file:///tmp/out/runs/gfs/2026041200/"
                f"{DEFAULT_RUN_ID}/status/wind10m_uv/003._SUCCESS.json"
            ),
        )

        self.assertEqual(marker.artifact_id, "wind10m_uv")
        self.assertEqual(marker.dataset_id, "gfs")
        self.assertEqual(marker.run_id, DEFAULT_RUN_ID)
        self.assertEqual(marker.code_revision, DEFAULT_CODE_REVISION)
        self.assertEqual(marker.image_identity, DEFAULT_IMAGE_IDENTITY)
        self.assertEqual(marker.config_digest, DEFAULT_CONFIG_DIGEST)
        self.assertEqual(marker.artifact.byte_length, 24)
        self.assertEqual(marker.artifact.components, ("u", "v"))
        self.assertEqual(marker.artifact.grid["nx"], grid["nx"])

    def test_parse_artifact_success_marker_rejects_unexpected_presentation_fields(self) -> None:
        payload = artifact_marker_payload(
            unexpected_presentation_field="legacy",
        )
        with self.assertRaises(SystemExit) as raised:
            parse_artifact_success_marker(
                {
                    "cycle": "2026041200",
                    "run_id": DEFAULT_RUN_ID,
                    "dataset_id": "gfs",
                    "frame_id": "003",
                    "artifact_id": "wind10m_uv",
                    "code_revision": DEFAULT_CODE_REVISION,
                    "image_identity": DEFAULT_IMAGE_IDENTITY,
                    "config_digest": DEFAULT_CONFIG_DIGEST,
                    "artifact": payload,
                },
                uri=(
                    "file:///tmp/out/runs/gfs/2026041200/"
                    f"{DEFAULT_RUN_ID}/status/wind10m_uv/003._SUCCESS.json"
                ),
            )

        message = str(raised.exception)
        self.assertIn("Extra inputs are not permitted", message)
        self.assertIn("unexpected_presentation_field", message)

    def test_parse_artifact_success_marker_requires_artifact_payload(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            parse_artifact_success_marker(
                {
                    "cycle": "2026041200",
                    "run_id": DEFAULT_RUN_ID,
                    "dataset_id": "gfs",
                    "frame_id": "003",
                    "artifact_id": "tmp_surface",
                    "code_revision": DEFAULT_CODE_REVISION,
                    "image_identity": DEFAULT_IMAGE_IDENTITY,
                    "config_digest": DEFAULT_CONFIG_DIGEST,
                },
                uri=(
                    "file:///tmp/out/runs/gfs/2026041200/"
                    f"{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json"
                ),
            )

        self.assertIn("artifact", str(raised.exception))
        self.assertIn("Field required", str(raised.exception))

    def test_parse_artifact_success_marker_requires_run_id(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            parse_artifact_success_marker(
                {
                    "cycle": "2026041200",
                    "dataset_id": "gfs",
                    "frame_id": "003",
                    "artifact_id": "tmp_surface",
                    "code_revision": DEFAULT_CODE_REVISION,
                    "image_identity": DEFAULT_IMAGE_IDENTITY,
                    "config_digest": DEFAULT_CONFIG_DIGEST,
                    "artifact": artifact_marker_payload(),
                },
                uri=(
                    "file:///tmp/out/runs/gfs/2026041200/"
                    f"{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json"
                ),
            )

        self.assertIn("run_id", str(raised.exception))
        self.assertIn("Field required", str(raised.exception))
