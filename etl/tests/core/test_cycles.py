from __future__ import annotations

from datetime import datetime, timezone

import pytest
from weather_etl.core.cycles import (
    cycle_datetime,
    expected_synoptic_cycle,
    latest_synoptic_cycles,
    parse_cycle,
    split_cycle,
    validate_cycle_id,
)


def test_latest_synoptic_cycles_returns_newest_first() -> None:
    assert latest_synoptic_cycles(now=datetime(2026, 5, 11, 13, 14, tzinfo=timezone.utc), count=2) == (
        "2026051112",
        "2026051106",
    )


def test_latest_synoptic_cycles_handles_midnight_wrap() -> None:
    assert latest_synoptic_cycles(now=datetime(2026, 5, 11, 1, 14, tzinfo=timezone.utc), count=2) == (
        "2026051100",
        "2026051018",
    )


def test_expected_synoptic_cycle_honors_grace_hours() -> None:
    assert (
        expected_synoptic_cycle(now=datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc), grace_hours=3, count=4)
        == "2026051112"
    )


def test_cycle_datetime_validates_cycle_shape() -> None:
    assert cycle_datetime("2026051112").isoformat() == "2026-05-11T12:00:00+00:00"
    with pytest.raises(ValueError):
        cycle_datetime("20260511")


def test_parse_cycle_returns_date_and_hour() -> None:
    assert parse_cycle("2026051112") == ("20260511", "12")
    with pytest.raises(SystemExit):
        parse_cycle("20260511")


def test_split_cycle_returns_date_and_hour() -> None:
    assert split_cycle("2026051112") == ("20260511", "12")
    with pytest.raises(ValueError):
        split_cycle("20260511")


def test_validate_cycle_id_strips_and_validates_cycle_shape() -> None:
    assert validate_cycle_id(" 2026051112 ") == "2026051112"
    with pytest.raises(ValueError):
        validate_cycle_id("20260511")
