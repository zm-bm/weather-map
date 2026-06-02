from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.commands.run_frame import run_process_frame
from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.extract.types import ExtractedBand
from forecast_etl.proc import RunResult
from forecast_etl.run_metadata import RunMetadata
from forecast_etl.runtime import ExecutionContext
from forecast_etl.source_adapters.base import PreparedSource
from forecast_etl.storage.local import LocalFSStore
from forecast_etl.tests.fixtures.artifact_configs import minimal_artifact_config
from forecast_etl.tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_CONFIG_DIGEST,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_RUN_ID,
)
from forecast_etl.tests.fixtures.grids import pack_f32, small_grid_meta_fixture
from forecast_etl.tests.fixtures.pipeline import add_dataset_artifact, minimal_pipeline_config


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class RunHourCommandTest(unittest.TestCase):
    def test_run_process_frame_reads_grid_once_for_all_artifacts(self) -> None:
        cfg = minimal_pipeline_config()
        rh_config = {
            **minimal_artifact_config(),
            "parameter": "rh",
            "units": "%",
            "encoding": {
                "id": "rh_surface_i16_v1",
                "format": "linear-i16-v1",
                "dtype": "int16",
                "byte_order": "little",
                "scale": 0.01,
                "offset": 0.0,
                "nodata": -32768,
            },
            "components": [
                {
                    "id": "value",
                    "grib_match": {
                        "GRIB_ELEMENT": "RH",
                    },
                }
            ],
        }
        add_dataset_artifact(cfg, dataset_id="gfs", artifact_id="rh_surface", artifact_config=rh_config)
        cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["tmp_surface", "rh_surface"]
        model = parse_pipeline_config(cfg).dataset("gfs")

        with tempfile.TemporaryDirectory(prefix="weather-map-run-frame-") as td:
            root = Path(td)
            grib_path = root / "input.grib2"
            grib_path.write_bytes(b"grib")
            artifacts = ArtifactRepository.for_root(
                store=LocalFSStore(),
                artifact_root_uri=(root / "out").as_uri(),
            )
            source = PreparedSource.grib(
                uri="file:///tmp/input.grib2",
                path=grib_path,
                grid_id="gfs_0p25_global",
            )
            grid = small_grid_meta_fixture()
            band = ExtractedBand(
                component_id="value",
                source_f32_bytes=pack_f32([0.0, 1.0, 2.0, 3.0], byte_order="little"),
                source_byte_order="little",
            )

            with (
                patch("forecast_etl.commands.run_frame.acquire_prepared_source", return_value=source),
                patch("forecast_etl.commands.run_frame.grid_meta_from_grib", return_value=grid) as grid_meta,
                patch("forecast_etl.commands.run_frame.extract_artifact_bands", return_value=[band]) as extract_bands,
            ):
                run_process_frame(
                    ctx=ExecutionContext(
                        dataset_id="gfs",
                        artifact_root_uri=artifacts.paths.artifact_root_uri,
                        frames=("000",),
                    ),
                    model=model,
                    cycle="2026041200",
                    run_id=DEFAULT_RUN_ID,
                    frame_id="000",
                    source_uri=None,
                    artifact_ids=model.workload.artifacts,
                    artifact_specs=model.artifacts,
                    store=artifacts.store,
                    artifact_repo=artifacts,
                    run=_unused_run,
                    run_metadata=RunMetadata(
                        code_revision=DEFAULT_CODE_REVISION,
                        image_identity=DEFAULT_IMAGE_IDENTITY,
                        config_digest=DEFAULT_CONFIG_DIGEST,
                    ),
                )

            for artifact_id in ("tmp_surface", "rh_surface"):
                marker = artifacts.read_artifact_success_marker(
                    dataset_id="gfs",
                    cycle="2026041200",
                    run_id=DEFAULT_RUN_ID,
                    frame_id="000",
                    artifact_id=artifact_id,
                )
                self.assertEqual(marker.artifact.byte_length, 8)
                self.assertEqual(marker.run_id, DEFAULT_RUN_ID)
                self.assertEqual(marker.code_revision, DEFAULT_CODE_REVISION)
                self.assertEqual(marker.image_identity, DEFAULT_IMAGE_IDENTITY)
                self.assertEqual(marker.config_digest, DEFAULT_CONFIG_DIGEST)
                self.assertTrue(
                    artifacts.store.exists(
                        uri=artifacts.paths.success_marker_uri_parts(
                            dataset_id="gfs",
                            cycle="2026041200",
                            run_id=DEFAULT_RUN_ID,
                            artifact_id=artifact_id,
                            frame_id="000",
                        )
                    )
                )

            self.assertTrue(
                artifacts.store.exists(
                    uri=artifacts.paths.run_metadata_uri(
                        dataset_id="gfs",
                        cycle="2026041200",
                        run_id=DEFAULT_RUN_ID,
                    )
                )
            )
            self.assertTrue(
                artifacts.store.exists(
                    uri=artifacts.paths.run_pipeline_config_uri(
                        dataset_id="gfs",
                        cycle="2026041200",
                        run_id=DEFAULT_RUN_ID,
                    )
                )
            )
            self.assertFalse((root / "out" / "fields" / "gfs" / "2026041200").exists())
            self.assertFalse((root / "out" / "status" / "gfs" / "2026041200").exists())

        grid_meta.assert_called_once_with(grib_path=grib_path, run=_unused_run)
        self.assertEqual(extract_bands.call_count, 2)


if __name__ == "__main__":
    unittest.main()
