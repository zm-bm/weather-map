"""UTC timestamp helpers."""

from __future__ import annotations

from datetime import datetime, timezone


def as_utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime, treating naive values as UTC."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def parse_iso_datetime_utc(value: object) -> datetime:
    """Parse an ISO datetime value and return it normalized to UTC."""

    if isinstance(value, datetime):
        return as_utc(value)
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO datetime string")
    stripped = value.strip()
    if not stripped:
        raise ValueError("timestamp must not be blank")
    try:
        return as_utc(datetime.fromisoformat(stripped.replace("Z", "+00:00")))
    except ValueError as exc:
        raise ValueError("timestamp must be an ISO datetime string") from exc


def isoformat_utc(value: datetime) -> str:
    """Return a second-precision UTC ISO string with a trailing Z."""

    return as_utc(value).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def utc_now_iso() -> str:
    """Return the current UTC time as a second-precision ISO string."""

    return isoformat_utc(datetime.now(timezone.utc))
