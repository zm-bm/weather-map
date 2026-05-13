from __future__ import annotations

import unittest

from forecast_etl.artifacts.markers_schema import parse_product_success_marker
from forecast_etl.tests.fixtures.artifacts import product_marker_payload
from forecast_etl.tests.fixtures.grids import grid_meta_fixture


class ProductSuccessMarkerTest(unittest.TestCase):
    def test_parse_product_success_marker_normalizes_product_payload(self) -> None:
        grid = grid_meta_fixture()
        marker = parse_product_success_marker(
            {
                "cycle": "2026041200",
                "fhour": "003",
                "product_id": "wind10m_uv",
                "product": product_marker_payload(
                    payload_uri="file:///tmp/out/fields/gfs/2026041200/003/wind10m_uv.field.i8.bin",
                    byte_length=24,
                    format="linear-i8-v1",
                    encoding_id="wind10m_uv_vector_i8_v1",
                    units="m/s",
                    parameter="wind_uv",
                    level="10m_above_ground",
                    # Legacy presentation fields should be tolerated but not
                    # carried into the normalized marker payload.
                    valid_min=-64,
                    valid_max=63.5,
                    grid_id="gfs_0p25_global",
                    grid=grid,
                    components=["u", "v"],
                    style={
                        "layer_id": "vector",
                        "palette_id": "wind.vector.mps.v1",
                    },
                ),
            },
            uri="file:///tmp/out/status/gfs/2026041200/wind10m_uv/003._SUCCESS.json",
        )

        self.assertEqual(marker.product_id, "wind10m_uv")
        self.assertEqual(marker.product.byte_length, 24)
        self.assertEqual(marker.product.components, ("u", "v"))
        self.assertEqual(marker.product.grid["nx"], grid["nx"])
        self.assertFalse(hasattr(marker.product, "valid_min"))
        self.assertFalse(hasattr(marker.product, "style"))

    def test_parse_product_success_marker_requires_product_payload(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            parse_product_success_marker(
                {
                    "cycle": "2026041200",
                    "fhour": "003",
                    "product_id": "tmp_surface",
                },
                uri="file:///tmp/out/status/gfs/2026041200/tmp_surface/003._SUCCESS.json",
            )

        self.assertIn("product", str(raised.exception))
        self.assertIn("Field required", str(raised.exception))
