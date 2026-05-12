from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from forecast_etl.source_adapters.base import PreparedSource


class PreparedSourceTest(unittest.TestCase):
    def test_single_grib_source_uses_one_path_for_reference_and_components(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-prepared-single-") as td:
            path = Path(td) / "input.grib2"
            path.write_bytes(b"grib")

            source = PreparedSource.grib(uri="file:///tmp/input.grib2", path=path, grid_id="gfs_0p25_global")

            self.assertEqual(source.reference_grib_path(), path)
            self.assertEqual(
                source.component_grib_path(
                    product_id="tmp_surface",
                    component_id="value",
                    grib_match={"GRIB_ELEMENT": "TMP"},
                ),
                path,
            )

    def test_grib_collection_requires_non_empty_paths(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            PreparedSource.grib_collection(
                uri="icon-dwd://icon/2026041200/003",
                grib_paths={},
                grid_id="icon_global_regridded_0p125",
            )

        self.assertIn("requires at least one GRIB path", str(raised.exception))

    def test_grib_collection_requires_selector_key_in_component_match(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-prepared-missing-selector-") as td:
            path = Path(td) / "tmp.regridded.grib2"
            source = PreparedSource.grib_collection(
                uri="icon-dwd://icon/2026041200/003",
                grib_paths={"t_2m": path},
                grid_id="icon_global_regridded_0p125",
            )

            with self.assertRaises(SystemExit) as raised:
                source.component_grib_path(
                    product_id="tmp_surface",
                    component_id="value",
                    grib_match={"GRIB_ELEMENT": "TMP"},
                )

        self.assertIn("requires ICON_PARAM", str(raised.exception))

    def test_grib_collection_rejects_unknown_selector_value(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-prepared-unknown-selector-") as td:
            path = Path(td) / "tmp.regridded.grib2"
            source = PreparedSource.grib_collection(
                uri="icon-dwd://icon/2026041200/003",
                grib_paths={"t_2m": path},
                grid_id="icon_global_regridded_0p125",
            )

            with self.assertRaises(SystemExit) as raised:
                source.component_grib_path(
                    product_id="tmp_surface",
                    component_id="value",
                    grib_match={"ICON_PARAM": "rh_2m"},
                )

        self.assertIn("missing ICON_PARAM 'rh_2m'", str(raised.exception))

    def test_grib_collection_normalizes_selector_values_and_supports_custom_selector_key(self) -> None:
        with tempfile.TemporaryDirectory(prefix="weather-map-prepared-selector-case-") as td:
            path = Path(td) / "tmp.regridded.grib2"
            source = PreparedSource.grib_collection(
                uri="custom://source",
                grib_paths={"T_2M": path},
                grid_id="custom_grid",
                selector_key="MODEL_PARAM",
            )

            self.assertEqual(source.reference_grib_path(), path)
            self.assertEqual(
                source.component_grib_path(
                    product_id="tmp_surface",
                    component_id="value",
                    grib_match={"MODEL_PARAM": "t_2m"},
                ),
                path,
            )
