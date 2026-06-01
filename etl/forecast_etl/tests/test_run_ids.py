from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from forecast_etl.run_ids import generate_run_id, parse_run_id, validate_run_id


class RunIdTest(unittest.TestCase):
    def test_generate_run_id_uses_utc_timestamp_and_hex_suffix(self) -> None:
        with patch("forecast_etl.run_ids.secrets.token_hex", return_value="abcdef12"):
            run_id = generate_run_id(now=datetime(2026, 5, 31, 1, 2, 3, tzinfo=timezone.utc))

        self.assertEqual(run_id, "20260531T010203Z-abcdef12")

    def test_validate_run_id_accepts_expected_shape(self) -> None:
        self.assertEqual(validate_run_id(" 20260531T010203Z-abcdef12 "), "20260531T010203Z-abcdef12")

    def test_parse_run_id_rejects_unsafe_values(self) -> None:
        with self.assertRaises(SystemExit):
            parse_run_id("20260531T010203Z-ABCDEF12")


if __name__ == "__main__":
    unittest.main()
