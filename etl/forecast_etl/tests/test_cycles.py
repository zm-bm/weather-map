from __future__ import annotations

import unittest
from datetime import datetime, timezone

from forecast_etl.cycles import (
    cycle_date_hour,
    cycle_datetime,
    expected_synoptic_cycle,
    latest_synoptic_cycles,
    parse_cycle,
)


class CycleUtilsTest(unittest.TestCase):
    def test_latest_synoptic_cycles_returns_newest_first(self) -> None:
        self.assertEqual(
            latest_synoptic_cycles(now=datetime(2026, 5, 11, 13, 14, tzinfo=timezone.utc), count=2),
            ("2026051112", "2026051106"),
        )

    def test_latest_synoptic_cycles_handles_midnight_wrap(self) -> None:
        self.assertEqual(
            latest_synoptic_cycles(now=datetime(2026, 5, 11, 1, 14, tzinfo=timezone.utc), count=2),
            ("2026051100", "2026051018"),
        )

    def test_expected_synoptic_cycle_honors_grace_hours(self) -> None:
        self.assertEqual(
            expected_synoptic_cycle(now=datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc), grace_hours=3, count=4),
            "2026051112",
        )

    def test_cycle_datetime_validates_cycle_shape(self) -> None:
        self.assertEqual(cycle_datetime("2026051112").isoformat(), "2026-05-11T12:00:00+00:00")
        with self.assertRaises(ValueError):
            cycle_datetime("20260511")

    def test_parse_cycle_returns_date_and_hour(self) -> None:
        self.assertEqual(parse_cycle("2026051112"), ("20260511", "12"))
        with self.assertRaises(SystemExit):
            parse_cycle("20260511")

    def test_cycle_date_hour_returns_date_and_hour(self) -> None:
        self.assertEqual(cycle_date_hour("2026051112"), ("20260511", "12"))
        with self.assertRaises(ValueError):
            cycle_date_hour("20260511")


if __name__ == "__main__":
    unittest.main()
