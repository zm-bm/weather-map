from __future__ import annotations

import bz2
import io
import os
import tempfile
import unittest
import urllib.error
from email.message import Message
from pathlib import Path
from unittest.mock import patch

from forecast_etl.config.parse import parse_pipeline_config
from forecast_etl.config.schema import IconDwdConfig, ModelConfig, ModelSourceConfig, WorkloadConfig
from forecast_etl.models import acquire_prepared_source
from forecast_etl.models.icon import icon_dwd_filename, icon_dwd_url
from forecast_etl.stores import make_store
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config
from forecast_etl.tests.fixtures.products import minimal_product_config, product_spec


class _FakeHttpResponse(io.BytesIO):
    def __init__(self, payload: bytes, *, status: int = 200) -> None:
        super().__init__(payload)
        self.status = status
        self.headers = {"Content-Length": str(len(payload))}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


class ModelSourceAdapterTest(unittest.TestCase):
    def test_gfs_adapter_uses_source_uri_override(self) -> None:
        model = parse_pipeline_config(minimal_pipeline_config()).model("gfs")
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

            self.assertEqual(source.grid_id, "gfs_0p25_global")
            self.assertEqual(source.reference_grib_path(), workdir / "input.grib2")
            self.assertEqual(
                source.component_grib_path(
                    product_id="tmp_surface",
                    component_id="value",
                    grib_match={"GRIB_ELEMENT": "TMP"},
                ),
                workdir / "input.grib2",
            )
            self.assertEqual(source.reference_grib_path().read_bytes(), b"grib")

    def test_icon_dwd_url_uses_cycle_hour_parameter_folder_and_uppercase_filename(self) -> None:
        self.assertEqual(
            icon_dwd_url(
                base_url="https://opendata.dwd.de/weather/nwp/icon/grib",
                cycle="2026042800",
                fhour="003",
                icon_param="t_2m",
            ),
            "https://opendata.dwd.de/weather/nwp/icon/grib/00/t_2m/"
            "icon_global_icosahedral_single-level_2026042800_003_T_2M.grib2.bz2",
        )

    def test_icon_regrid_command_writes_expected_output(self) -> None:
        from forecast_etl.models import icon

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-regrid-") as td:
            tmp = Path(td)
            input_path = tmp / "input.grib2"
            output_path = tmp / "output.grib2"
            description_path = tmp / "icon_description.txt"
            weights_path = tmp / "icon_weights.nc"
            input_path.write_bytes(b"grib")
            description_path.write_text("gridtype = lonlat\n", encoding="utf-8")
            weights_path.write_bytes(b"weights")
            calls = []

            def fake_run(argv):
                calls.append(tuple(str(part) for part in argv))
                Path(argv[-1]).write_bytes(b"regridded")

            with (
                patch("forecast_etl.models.icon.shutil.which", return_value="/usr/bin/cdo"),
                patch("forecast_etl.models.icon.make_runner", return_value=fake_run),
            ):
                regridded = icon._regrid_if_needed(
                    input_path=input_path,
                    output_path=output_path,
                    description_file=description_path,
                    weights_file=weights_path,
                )
            output_bytes = output_path.read_bytes()

        self.assertTrue(regridded)
        self.assertEqual(calls[0][0], "/usr/bin/cdo")
        self.assertEqual(calls[0][1:3], ("-f", "grb2"))
        self.assertEqual(
            calls[0][3],
            f"remap,{description_path.as_posix()},{weights_path.as_posix()}",
        )
        self.assertEqual(calls[0][4], input_path.as_posix())
        self.assertEqual(calls[0][5], output_path.with_suffix(output_path.suffix + ".tmp").as_posix())
        self.assertEqual(output_bytes, b"regridded")

    def test_icon_adapter_reuses_cached_regridded_files(self) -> None:
        product_config = minimal_product_config()
        product_config["components"][0]["grib_match"] = {"ICON_PARAM": "t_2m"}
        product = product_spec("tmp_surface", product_config)
        model = ModelConfig(
            id="icon",
            label="ICON",
            source=ModelSourceConfig(
                type="icon_dwd_icosahedral",
                grid_id="icon_global_regridded_0p125",
                icon_dwd=IconDwdConfig(
                    base_url="https://opendata.dwd.de/weather/nwp/icon/grib",
                    rate_limit_seconds=0.0,
                ),
            ),
            workload=WorkloadConfig(forecast_hours=("000",), products=("tmp_surface",)),
            model_products={},
            products={"tmp_surface": product},
            product_groups=(),
        )

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-source-") as td:
            tmp = Path(td)
            cache_dir = tmp / "cache" / "grib" / "icon" / "2026042800" / "000"
            cache_dir.mkdir(parents=True)
            filename = icon_dwd_filename(cycle="2026042800", fhour="000", icon_param="t_2m")
            (cache_dir / filename).write_bytes(bz2.compress(b"grib"))
            (cache_dir / filename.removesuffix(".bz2")).write_bytes(b"grib")
            regridded_path = cache_dir / "t_2m.regridded.grib2"
            regridded_path.write_bytes(b"regridded")

            with (
                patch.dict(os.environ, {"ICON_SOURCE_MIN_BYTES": "1"}, clear=False),
                patch("forecast_etl.models.icon.default_etl_dir", return_value=tmp),
                patch("forecast_etl.models.icon.make_runner", side_effect=AssertionError("regrid should be cached")),
            ):
                source = acquire_prepared_source(
                    model=model,
                    cycle="2026042800",
                    fhour="000",
                    source_uri_override=None,
                    workdir=tmp / "work",
                    store=make_store(),
                )

        self.assertEqual(source.grid_id, "icon_global_regridded_0p125")
        self.assertEqual(source.reference_grib_path(), regridded_path)
        self.assertEqual(
            source.component_grib_path(
                product_id="tmp_surface",
                component_id="value",
                grib_match={"ICON_PARAM": "T_2M"},
            ),
            regridded_path,
        )

    def test_icon_regrid_requires_cdo(self) -> None:
        from forecast_etl.models import icon

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-regrid-missing-") as td:
            input_path = Path(td) / "input.grib2"
            output_path = Path(td) / "output.grib2"
            input_path.write_bytes(b"grib")

            with patch("forecast_etl.models.icon.shutil.which", return_value=None):
                with self.assertRaises(SystemExit) as raised:
                    icon._regrid_if_needed(
                        input_path=input_path,
                        output_path=output_path,
                    )

        self.assertIn("requires cdo", str(raised.exception))

    def test_icon_regrid_requires_description_and_weights_files(self) -> None:
        from forecast_etl.models import icon

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-regrid-assets-") as td:
            tmp = Path(td)
            input_path = tmp / "input.grib2"
            output_path = tmp / "output.grib2"
            input_path.write_bytes(b"grib")
            with patch("forecast_etl.models.icon.shutil.which", return_value="/usr/bin/cdo"):
                with self.assertRaises(SystemExit) as raised:
                    icon._regrid_if_needed(
                        input_path=input_path,
                        output_path=output_path,
                        description_file=tmp / "missing-description.txt",
                        weights_file=tmp / "missing-weights.nc",
                    )

        self.assertIn("description file not found", str(raised.exception))

    def test_icon_download_http_404_is_retryable_until_wait_expires(self) -> None:
        from forecast_etl.models import icon

        error = urllib.error.HTTPError(
            url="https://example.test/icon.grib2.bz2",
            code=404,
            msg="Not Found",
            hdrs=Message(),
            fp=io.BytesIO(b"missing"),
        )

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-download-error-") as td:
            out_path = Path(td) / "icon.grib2.bz2"
            with (
                patch.dict(os.environ, {"ICON_SOURCE_WAIT_SECONDS": "0", "ICON_SOURCE_MIN_BYTES": "1"}, clear=False),
                patch("forecast_etl.models.icon.urllib.request.urlopen", side_effect=error),
            ):
                with self.assertRaises(SystemExit) as raised:
                    icon._download_if_needed("https://example.test/icon.grib2.bz2", out_path)

        self.assertIn("ICON DWD source not ready after waiting", str(raised.exception))
        self.assertIn("HTTP 404 Not Found", str(raised.exception))

    def test_icon_download_retries_then_succeeds(self) -> None:
        from forecast_etl.models import icon

        error = urllib.error.HTTPError(
            url="https://example.test/icon.grib2.bz2",
            code=404,
            msg="Not Found",
            hdrs=Message(),
            fp=io.BytesIO(b"missing"),
        )

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-download-retry-") as td:
            out_path = Path(td) / "icon.grib2.bz2"
            with (
                patch.dict(
                    os.environ,
                    {
                        "ICON_SOURCE_WAIT_SECONDS": "1",
                        "ICON_SOURCE_MIN_BYTES": "1",
                        "ICON_SOURCE_RETRY_BASE_SECONDS": "0",
                    },
                    clear=False,
                ),
                patch("forecast_etl.models.icon.time.sleep"),
                patch(
                    "forecast_etl.models.icon.urllib.request.urlopen",
                    side_effect=[error, _FakeHttpResponse(b"payload")],
                ),
            ):
                downloaded = icon._download_if_needed("https://example.test/icon.grib2.bz2", out_path)
            output_bytes = out_path.read_bytes()

        self.assertTrue(downloaded)
        self.assertEqual(output_bytes, b"payload")

    def test_icon_prepare_cleans_bad_bz2_and_retries(self) -> None:
        from forecast_etl.models import icon

        product_config = minimal_product_config()
        product_config["components"][0]["grib_match"] = {"ICON_PARAM": "t_2m"}
        product = product_spec("tmp_surface", product_config)
        model = ModelConfig(
            id="icon",
            label="ICON",
            source=ModelSourceConfig(
                type="icon_dwd_icosahedral",
                grid_id="icon_global_regridded_0p125",
                icon_dwd=IconDwdConfig(
                    base_url="https://opendata.dwd.de/weather/nwp/icon/grib",
                    rate_limit_seconds=0.0,
                ),
            ),
            workload=WorkloadConfig(forecast_hours=("000",), products=("tmp_surface",)),
            model_products={},
            products={"tmp_surface": product},
            product_groups=(),
        )

        with tempfile.TemporaryDirectory(prefix="weather-map-icon-bad-bz2-") as td:
            tmp = Path(td)

            def fake_regrid(*, output_path: Path, **kwargs) -> bool:
                output_path.write_bytes(b"regridded")
                return True

            with (
                patch.dict(
                    os.environ,
                    {
                        "ICON_SOURCE_WAIT_SECONDS": "1",
                        "ICON_SOURCE_MIN_BYTES": "1",
                        "ICON_SOURCE_RETRY_BASE_SECONDS": "0",
                    },
                    clear=False,
                ),
                patch("forecast_etl.models.icon.default_etl_dir", return_value=tmp),
                patch("forecast_etl.models.icon.time.sleep"),
                patch("forecast_etl.models.icon._regrid_if_needed", side_effect=fake_regrid),
                patch(
                    "forecast_etl.models.icon.urllib.request.urlopen",
                    side_effect=[
                        _FakeHttpResponse(b"not-bzip2"),
                        _FakeHttpResponse(bz2.compress(b"grib")),
                    ],
                ),
            ):
                regridded_path, downloaded = icon._prepare_icon_param(
                    model=model,
                    cycle="2026042800",
                    fhour="000",
                    icon_param="t_2m",
                )
                output_bytes = regridded_path.read_bytes()

        self.assertTrue(downloaded)
        self.assertEqual(output_bytes, b"regridded")
