"""Shared Pydantic helpers for ETL boundary models."""

from __future__ import annotations

from typing import Annotated, Any, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, ValidationError

NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
PositiveInt = Annotated[int, Field(strict=True, gt=0)]
NonNegativeInt = Annotated[int, Field(strict=True, ge=0)]
HexSha256 = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9a-fA-F]{64}$")]
UniqueNonEmptyStringTuple = Annotated[
    tuple[NonEmptyStr, ...],
    Field(min_length=1),
    AfterValidator(lambda values: _unique_string_tuple(values)),
]
ModelT = TypeVar("ModelT", bound=BaseModel)


class FrozenModel(BaseModel):
    """Strict immutable Pydantic base for JSON boundary models."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
    )


class FrozenAliasModel(BaseModel):
    """Strict immutable Pydantic base that accepts field aliases."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
    )


def parse_model(model_type: type[ModelT], raw: object) -> ModelT:
    """Validate raw input and convert Pydantic errors to CLI-facing exits."""

    try:
        return model_type.model_validate(raw)
    except ValidationError as exc:
        raise SystemExit(str(exc)) from exc


def dump_model(model: BaseModel, *, by_alias: bool = False, exclude_none: bool = False) -> dict[str, Any]:
    """Dump a Pydantic model as JSON-compatible Python objects."""

    return model.model_dump(by_alias=by_alias, exclude_none=exclude_none, mode="json")


def validated_dict(
    model_type: type[ModelT],
    raw: object,
    *,
    by_alias: bool = False,
    exclude_none: bool = False,
) -> dict[str, Any]:
    """Validate raw input and return a JSON-compatible dictionary."""

    return dump_model(parse_model(model_type, raw), by_alias=by_alias, exclude_none=exclude_none)


def validator_dict(model_type: type[ModelT], raw: object, *, by_alias: bool = False) -> dict[str, Any]:
    """Validate nested values from a Pydantic validator and raise ValueError."""

    try:
        return dump_model(model_type.model_validate(raw), by_alias=by_alias)
    except ValidationError as exc:
        raise ValueError(str(exc)) from exc


def _unique_string_tuple(values: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"duplicate value: {value!r}")
        seen.add(value)
    return values
