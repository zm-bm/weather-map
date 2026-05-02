from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from forecast_etl.config.parse import parse_pipeline_config
from forecast_etl.config.schema import ModelConfig, ModelSourceConfig, WorkloadConfig
from forecast_etl.models import acquire_prepared_source
from forecast_etl.sources.prepared import PREPARED_SOURCE_GRIB, PREPARED_SOURCE_ZERO
from forecast_etl.stores import make_store
from forecast_etl.tests.product_test_helpers import _minimal_pipeline_config, _small_grid_meta_fixture


class ModelSourceAdapterTest(unittest.TestCase):
    def test_gfs_adapter_uses_source_uri_override(self) -> None:
        model = parse_pipeline_config(_minimal_pipeline_config()).model("gfs")
        with tempfile.TemporaryDirectory(prefix="weather-map-gfs-source-") as td:
            tmp = Path(td)
            source_path = tmp / "source.grib2"
            source_path.write_bytes(b"grib")
            workdir = tmp / "work"
            workdir.mkdir()

            source = acquire_prepared_source(
                model=model,
                cycle="2026041200",
                fhour="000",
                source_uri_override=f"file://{source_path.as_posix()}",
                workdir=workdir,
                store=make_store(),
            )

            self.assertEqual(source.kind, PREPARED_SOURCE_GRIB)
            self.assertEqual(source.path, workdir / "input.grib2")
            self.assertEqual(source.grid_id, "gfs_0p25_global")
            self.assertIsNotNone(source.path)
            assert source.path is not None
            self.assertEqual(source.path.read_bytes(), b"grib")

    def test_icon_adapter_returns_zero_source(self) -> None:
        model = ModelConfig(
            id="icon",
            label="ICON",
            source=ModelSourceConfig(
                type="zero_placeholder",
                grid_id="icon_zero_placeholder",
                grid=_small_grid_meta_fixture(),
            ),
            workload=WorkloadConfig(forecast_hours=("000",), products=("tmp_surface",)),
            product_bindings={},
            products={},
            scalar_variable_groups=(),
        )
        with tempfile.TemporaryDirectory(prefix="weather-map-icon-source-") as td:
            source = acquire_prepared_source(
                model=model,
                cycle="2026041200",
                fhour="000",
                source_uri_override=None,
                workdir=Path(td),
                store=make_store(),
            )

        self.assertEqual(source.kind, PREPARED_SOURCE_ZERO)
        self.assertEqual(source.uri, "zero://icon")
        self.assertEqual(source.grid_id, "icon_zero_placeholder")
        self.assertIsNotNone(source.grid)
        assert source.grid is not None
        self.assertEqual(source.grid["nx"], 2)
