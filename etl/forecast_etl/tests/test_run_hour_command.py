from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.commands.run_hour import run_process_hour
from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.extract.types import ExtractedBand
from forecast_etl.proc import RunResult
from forecast_etl.runtime import ExecutionContext
from forecast_etl.source_adapters.base import PreparedSource
from forecast_etl.storage.local import LocalFSStore
from forecast_etl.tests.fixtures.grids import pack_f32, small_grid_meta_fixture
from forecast_etl.tests.fixtures.pipeline import add_model_product, minimal_pipeline_config
from forecast_etl.tests.fixtures.products import minimal_product_config


def _unused_run(*_args: object, **_kwargs: object) -> RunResult:
    return RunResult(argv=(), returncode=0)


class RunHourCommandTest(unittest.TestCase):
    def test_run_process_hour_reads_grid_once_for_all_products(self) -> None:
        cfg = minimal_pipeline_config()
        rh_config = {
            **minimal_product_config(),
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
        add_model_product(cfg, model_id="gfs", product_id="rh_surface", product_config=rh_config)
        cfg["models"]["gfs"]["workload"]["products"] = ["tmp_surface", "rh_surface"]
        model = parse_pipeline_config(cfg).model("gfs")

        with tempfile.TemporaryDirectory(prefix="weather-map-run-hour-") as td:
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
                patch("forecast_etl.commands.run_hour.acquire_prepared_source", return_value=source),
                patch("forecast_etl.commands.run_hour.grid_meta_from_grib", return_value=grid) as grid_meta,
                patch("forecast_etl.commands.run_hour.extract_product_bands", return_value=[band]) as extract_bands,
            ):
                run_process_hour(
                    ctx=ExecutionContext(
                        model_id="gfs",
                        artifact_root_uri=artifacts.paths.artifact_root_uri,
                        forecast_hours=("000",),
                    ),
                    model=model,
                    cycle="2026041200",
                    fhour="000",
                    source_uri=None,
                    product_ids=model.workload.products,
                    products=model.products,
                    store=artifacts.store,
                    artifacts=artifacts,
                    run=_unused_run,
                )

            for product_id in ("tmp_surface", "rh_surface"):
                marker = artifacts.read_product_success_marker(
                    model_id="gfs",
                    cycle="2026041200",
                    fhour="000",
                    product_id=product_id,
                )
                self.assertEqual(marker.product.byte_length, 8)

        grid_meta.assert_called_once_with(grib_path=grib_path, run=_unused_run)
        self.assertEqual(extract_bands.call_count, 2)


if __name__ == "__main__":
    unittest.main()
