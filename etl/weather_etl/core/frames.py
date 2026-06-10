"""Frame id helpers shared by runtime and forecast lead-hour code."""

from __future__ import annotations


def validate_frame_id(frame_id: str) -> str:
    """Validate a generic frame id that is safe to use as one URI segment."""

    value = str(frame_id).strip()
    if not value:
        raise ValueError("frame_id must be non-empty")
    if value in {".", ".."}:
        raise ValueError(f"frame_id must not be a relative path segment: {frame_id!r}")
    if "/" in value or "\\" in value:
        raise ValueError(f"frame_id must not contain path separators: {frame_id!r}")
    return value


def format_lead_hour_frame_id(value: int | str) -> str:
    """Format a forecast lead-hour frame id as the current canonical string."""

    raw = str(value).strip()
    if not raw.isdigit():
        raise ValueError(f"lead-hour frame id must be an integer in the range 0..999: {value!r}")
    hour = int(raw, 10)
    if hour < 0 or hour > 999:
        raise ValueError(f"lead-hour frame id must be in the range 0..999: {value!r}")
    return f"{hour:03d}"


def parse_lead_hour_frame_id(frame_id: str) -> int:
    """Parse a canonical forecast lead-hour frame id."""

    value = validate_frame_id(frame_id)
    if len(value) != 3 or not value.isdigit():
        raise ValueError(f"lead-hour frame id must be the canonical zero-padded form, got: {frame_id!r}")
    return int(value, 10)
