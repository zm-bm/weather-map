from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import pytest
from pydantic import Field, ValidationError
from weather_etl.core.validation import (
    FrozenAliasModel,
    FrozenModel,
    NonEmptyStr,
    UniqueNonEmptyStringTuple,
    UtcDateTime,
    parse_model,
    validated_dict,
)
from weather_etl.environment.context import ExecutionContext
from weather_etl.storage.uris import file_uri


class _AliasExample(FrozenAliasModel):
    schema_name: Literal["example"] = Field(alias="schema")
    value: NonEmptyStr


class _TupleExample(FrozenModel):
    values: UniqueNonEmptyStringTuple


class _TimestampExample(FrozenModel):
    generated_at: UtcDateTime


def test_frozen_alias_model_accepts_field_name_and_dumps_aliases() -> None:
    assert parse_model(_AliasExample, {"schema_name": "example", "value": " ok "}).value == "ok"
    assert validated_dict(_AliasExample, {"schema": "example", "value": " ok "}, by_alias=True) == {
        "schema": "example",
        "value": "ok",
    }


def test_unique_non_empty_string_tuple_rejects_duplicates() -> None:
    with pytest.raises(SystemExit):
        parse_model(_TupleExample, {"values": ["a", "a"]})


def test_utc_datetime_normalizes_iso_strings() -> None:
    parsed = _TimestampExample(generated_at="2026-05-11T07:30:00-05:00")

    assert parsed.generated_at == datetime(2026, 5, 11, 12, 30, tzinfo=timezone.utc)


def test_utc_datetime_rejects_invalid_values() -> None:
    with pytest.raises(ValidationError):
        _TimestampExample(generated_at="not-a-date")


def test_execution_context_normalizes_artifact_root_and_frames(tmp_path: Path) -> None:
    ctx = ExecutionContext(
        dataset_id=" gfs ",
        artifact_root_uri=str(tmp_path / "artifacts"),
        frames=(" 000 ", "radar-20260601T120500Z"),
    )

    assert ctx.dataset_id == "gfs"
    assert ctx.artifact_root_uri == file_uri(tmp_path / "artifacts")
    assert ctx.frames == ("000", "radar-20260601T120500Z")


@pytest.mark.parametrize(
    "kwargs",
    (
        {"dataset_id": "gfs", "artifact_root_uri": "s3://artifacts", "frames": ("003/004",)},
        {"dataset_id": "gfs", "artifact_root_uri": "https://example.test/artifacts", "frames": ("000",)},
    ),
)
def test_execution_context_rejects_invalid_runtime_identity(kwargs: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ExecutionContext(**kwargs)
