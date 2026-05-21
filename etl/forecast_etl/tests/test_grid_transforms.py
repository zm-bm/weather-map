from __future__ import annotations

import math
import struct
import unittest

from forecast_etl.extract.grid_transforms import (
    regular_grid_downsample_2x_bytes,
    regular_grid_downsample_2x_meta,
)
from forecast_etl.tests.fixtures.grids import pack_f32


def _grid(nx: int = 5, ny: int = 3) -> dict:
    return {
        "crs": "EPSG:4326",
        "nx": nx,
        "ny": ny,
        "lon0": 180.0,
        "lat0": 90.0,
        "dx": 0.125,
        "dy": -0.125,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def _unpack_f32(data: bytes) -> tuple[float, ...]:
    return struct.unpack(f"<{len(data) // 4}f", data)


class GridTransformTest(unittest.TestCase):
    def test_regular_grid_downsample_2x_updates_odd_grid_metadata(self) -> None:
        result = regular_grid_downsample_2x_meta(_grid())

        self.assertEqual(result["nx"], 3)
        self.assertEqual(result["ny"], 2)
        self.assertEqual(result["lon0"], 180.0)
        self.assertEqual(result["lat0"], 90.0)
        self.assertEqual(result["dx"], 0.25)
        self.assertEqual(result["dy"], -0.25)
        self.assertEqual(result["x_wrap"], "repeat")

    def test_regular_grid_downsample_2x_uses_prefilter_wrap_and_bounds(self) -> None:
        values = [float(value) for value in range(15)]
        result = _unpack_f32(
            regular_grid_downsample_2x_bytes(
                pack_f32(values, byte_order="little"),
                byte_order="little",
                grid=_grid(),
            )
        )

        expected = (
            35 / 12,
            44 / 12,
            53 / 12,
            115 / 12,
            124 / 12,
            133 / 12,
        )
        for actual, expected_value in zip(result, expected):
            self.assertAlmostEqual(actual, expected_value, places=5)

    def test_regular_grid_downsample_2x_ignores_nan_weights(self) -> None:
        values = [float(value) for value in range(15)]
        values[0] = math.nan
        result = _unpack_f32(
            regular_grid_downsample_2x_bytes(
                pack_f32(values, byte_order="little"),
                byte_order="little",
                grid=_grid(),
            )
        )

        self.assertAlmostEqual(result[0], 35 / 8, places=5)

    def test_regular_grid_downsample_2x_outputs_nan_when_no_valid_samples_exist(self) -> None:
        result = _unpack_f32(
            regular_grid_downsample_2x_bytes(
                pack_f32([math.nan] * 9, byte_order="little"),
                byte_order="little",
                grid=_grid(nx=3, ny=3),
            )
        )

        self.assertTrue(all(math.isnan(value) for value in result))


if __name__ == "__main__":
    unittest.main()
