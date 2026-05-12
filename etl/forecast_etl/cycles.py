"""Forecast cycle utilities shared by ingest, ETL, and artifact consumers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

SYNOPTIC_CYCLE_HOURS = (0, 6, 12, 18)
CYCLE_FORMAT_MESSAGE = "cycle must be YYYYMMDDHH (10 digits), e.g. 2026011412"


def cycle_date_hour(cycle: str) -> tuple[str, str]:
    """Parse YYYYMMDDHH into (YYYYMMDD, HH)."""

    if len(cycle) != 10 or not cycle.isdigit():
        raise ValueError(CYCLE_FORMAT_MESSAGE)
    return cycle[:8], cycle[8:10]


def parse_cycle(cycle: str) -> tuple[str, str]:
    """Parse YYYYMMDDHH into (YYYYMMDD, HH), with CLI-friendly validation."""

    try:
        return cycle_date_hour(cycle)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def cycle_datetime(cycle: str) -> datetime:
    """Parse YYYYMMDDHH into a UTC datetime."""

    cycle_date, cycle_hour = cycle_date_hour(cycle)
    return datetime(
        int(cycle_date[0:4]),
        int(cycle_date[4:6]),
        int(cycle_date[6:8]),
        int(cycle_hour),
        tzinfo=timezone.utc,
    )


def latest_synoptic_cycles(
    *,
    now: datetime,
    count: int,
    cycle_hours: tuple[int, ...] = SYNOPTIC_CYCLE_HOURS,
) -> tuple[str, ...]:
    """Return recent synoptic cycle ids newest first."""

    if count <= 0:
        return ()
    now = _utc(now)
    hours = tuple(sorted(set(cycle_hours)))
    if not hours:
        raise ValueError("cycle_hours must not be empty")
    if hours[0] < 0 or hours[-1] > 23:
        raise ValueError("cycle_hours must be hours in 0..23")

    floor_hours = [hour for hour in hours if hour <= now.hour]
    floor_hour = floor_hours[-1] if floor_hours else hours[-1]
    cursor = now.replace(hour=floor_hour, minute=0, second=0, microsecond=0)
    if floor_hour > now.hour:
        cursor -= timedelta(days=1)

    cycles: list[str] = []
    for _ in range(count):
        cycles.append(cursor.strftime("%Y%m%d%H"))
        cursor = _previous_cycle_datetime(cursor, hours)
    return tuple(cycles)


def expected_synoptic_cycle(*, now: datetime, grace_hours: float, count: int) -> str:
    """Return the newest cycle whose grace deadline has passed."""

    now = _utc(now)
    cycles = latest_synoptic_cycles(now=now, count=count)
    if not cycles:
        raise ValueError("count must be positive")
    for cycle in cycles:
        if cycle_datetime(cycle) + timedelta(hours=grace_hours) <= now:
            return cycle
    return cycles[-1]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _previous_cycle_datetime(cursor: datetime, hours: tuple[int, ...]) -> datetime:
    index = hours.index(cursor.hour)
    previous_hour = hours[index - 1]
    if previous_hour > cursor.hour:
        cursor -= timedelta(days=1)
    return cursor.replace(hour=previous_hour)
