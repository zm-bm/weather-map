from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from weather_etl.state.runs.ids import generate_run_id, parse_run_id, validate_run_id


def test_generate_run_id_uses_utc_timestamp_and_hex_suffix() -> None:
    with patch("weather_etl.state.runs.ids.secrets.token_hex", return_value="abcdef12"):
        run_id = generate_run_id(now=datetime(2026, 5, 31, 1, 2, 3, tzinfo=timezone.utc))

    assert run_id == "20260531T010203Z-abcdef12"


def test_validate_run_id_accepts_expected_shape() -> None:
    assert validate_run_id(" 20260531T010203Z-abcdef12 ") == "20260531T010203Z-abcdef12"


@pytest.mark.parametrize(
    "value",
    (
        "",
        "20260531T010203Z-ABCDEF12",
        "20260531T010203Z-abcdef123",
        "2026-05-31T01:02:03Z-abcdef12",
        "20260531T010203Z-abcdef12/extra",
    ),
)
def test_validate_run_id_rejects_invalid_or_unsafe_values(value: str) -> None:
    with pytest.raises(ValueError):
        validate_run_id(value)


def test_parse_run_id_rejects_unsafe_values() -> None:
    with pytest.raises(SystemExit):
        parse_run_id("20260531T010203Z-ABCDEF12")
