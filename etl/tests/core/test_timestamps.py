from __future__ import annotations

from datetime import datetime, timedelta, timezone

from weather_etl.core.timestamps import (
    as_utc,
    isoformat_utc,
    parse_iso_datetime_utc,
)


def test_as_utc_treats_naive_datetimes_as_utc() -> None:
    assert as_utc(datetime(2026, 5, 11, 12, 30)).isoformat() == "2026-05-11T12:30:00+00:00"


def test_parse_iso_datetime_utc_normalizes_offsets_and_z_suffix() -> None:
    assert parse_iso_datetime_utc("2026-05-11T12:30:00Z").isoformat() == "2026-05-11T12:30:00+00:00"
    assert parse_iso_datetime_utc("2026-05-11T07:30:00-05:00").isoformat() == "2026-05-11T12:30:00+00:00"


def test_isoformat_utc_uses_second_precision_z_suffix() -> None:
    value = datetime(2026, 5, 11, 7, 30, 42, 123456, tzinfo=timezone(timedelta(hours=-5)))

    assert isoformat_utc(value) == "2026-05-11T12:30:42Z"
