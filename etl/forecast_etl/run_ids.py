"""Run id generation and validation."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

RUN_ID_PATTERN = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{8}$")


def generate_run_id(*, now: datetime | None = None) -> str:
    """Generate a path-safe run id for one ETL cycle attempt."""

    resolved_now = _utc(now or datetime.now(timezone.utc))
    return f"{resolved_now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"


def validate_run_id(value: str) -> str:
    """Validate a run id and return its stripped form."""

    run_id = value.strip()
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("run_id must match YYYYMMDDTHHMMSSZ-<8 lowercase hex chars>")
    return run_id


def parse_run_id(value: str) -> str:
    """Validate a run id with CLI-friendly errors."""

    try:
        return validate_run_id(value)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
