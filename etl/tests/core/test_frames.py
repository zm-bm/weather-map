from __future__ import annotations

import pytest
from weather_etl.core.frames import format_lead_hour_frame_id, parse_lead_hour_frame_id, validate_frame_id


def test_validate_frame_id_accepts_safe_generic_frame_segments() -> None:
    assert validate_frame_id("radar-20260601T120500Z") == "radar-20260601T120500Z"
    assert validate_frame_id("  goes-east-ir-001  ") == "goes-east-ir-001"


@pytest.mark.parametrize("value", ("", " ", ".", "..", "003/004", r"003\\004"))
def test_validate_frame_id_rejects_unsafe_segments(value: str) -> None:
    with pytest.raises(ValueError):
        validate_frame_id(value)


def test_format_lead_hour_frame_id_normalizes_current_forecast_frames() -> None:
    assert format_lead_hour_frame_id(0) == "000"
    assert format_lead_hour_frame_id("3") == "003"
    assert format_lead_hour_frame_id("003") == "003"
    assert format_lead_hour_frame_id(999) == "999"


@pytest.mark.parametrize("value", ("frame-003", "-1", "1000"))
def test_format_lead_hour_frame_id_rejects_invalid_values(value: str) -> None:
    with pytest.raises(ValueError):
        format_lead_hour_frame_id(value)


def test_parse_lead_hour_frame_id_requires_canonical_frame_id() -> None:
    assert parse_lead_hour_frame_id("003") == 3
    assert parse_lead_hour_frame_id("999") == 999


@pytest.mark.parametrize("value", ("3", "frame-003", "1000"))
def test_parse_lead_hour_frame_id_rejects_noncanonical_values(value: str) -> None:
    with pytest.raises(ValueError):
        parse_lead_hour_frame_id(value)
