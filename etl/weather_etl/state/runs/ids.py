"""Run id generation and validation."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone

from ...core.timestamps import as_utc, isoformat_utc

RUN_ID_PATTERN = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{8}$")


def generate_run_id(*, now: datetime | None = None) -> str:
    """Generate a path-safe run id for one ETL cycle attempt."""

    resolved_now = as_utc(now or datetime.now(timezone.utc))
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


def run_id_created_at(value: str) -> str:
    """Return the timestamp embedded in a run id as an ISO UTC string."""

    run_id = validate_run_id(value)
    parsed = datetime.strptime(run_id.split("-", 1)[0], "%Y%m%dT%H%M%SZ")
    return isoformat_utc(parsed.replace(tzinfo=timezone.utc))
