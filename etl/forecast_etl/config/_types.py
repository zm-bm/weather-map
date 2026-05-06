"""Shared Pydantic types for ETL config models."""

from __future__ import annotations

from typing import Annotated, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, ValidationError


class ConfigModel(BaseModel):
    """Strict immutable Pydantic base for resolved and raw config objects."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
    )


NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
OptionalNonEmptyStr = NonEmptyStr | None
FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
ForecastHourInt = Annotated[int, Field(strict=True, ge=0, le=999)]
NonEmptyStringMap = Annotated[dict[NonEmptyStr, NonEmptyStr], Field(min_length=1)]


def unique_string_tuple(values: tuple[str, ...]) -> tuple[str, ...]:
    """Reject duplicate strings while preserving tuple order."""

    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"duplicate value: {value!r}")
        seen.add(value)
    return values


UniqueNonEmptyStringTuple = Annotated[
    tuple[NonEmptyStr, ...],
    Field(min_length=1),
    AfterValidator(unique_string_tuple),
]

ConfigModelT = TypeVar("ConfigModelT", bound=BaseModel)


def parse_config_model(model_type: type[ConfigModelT], raw: object) -> ConfigModelT:
    """Validate config input and present Pydantic errors as SystemExit."""

    try:
        return model_type.model_validate(raw)
    except ValidationError as exc:
        raise SystemExit(str(exc)) from exc
