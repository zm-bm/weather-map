"""Shared Pydantic helpers for ETL boundary models."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, TypeVar

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, ValidationError

from .timestamps import parse_iso_datetime_utc

_SHA256_DIGEST_RE = re.compile(r"^sha256:[0-9a-fA-F]{64}$")


def _unique_string_tuple(values: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ValueError(f"duplicate value: {value!r}")
        seen.add(value)
    return values


def validate_sha256_digest(value: Any) -> str:
    """Validate and normalize a full ``sha256:<64 hex>`` digest string."""

    if not isinstance(value, str):
        raise ValueError("Expected sha256 digest string")
    digest = value.strip()
    if not _SHA256_DIGEST_RE.fullmatch(digest):
        raise ValueError("Expected sha256 digest in form 'sha256:<64 hex chars>'")
    return digest.lower()


NonEmptyStr = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
PositiveInt = Annotated[int, Field(strict=True, gt=0)]
NonNegativeInt = Annotated[int, Field(strict=True, ge=0)]
LeadHourFrameInt = Annotated[int, Field(strict=True, ge=0, le=999)]
NonEmptyStringMap = Annotated[dict[NonEmptyStr, NonEmptyStr], Field(min_length=1)]
HexSha256 = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9a-fA-F]{64}$")]
Sha256Digest = Annotated[str, BeforeValidator(validate_sha256_digest)]
UtcDateTime = Annotated[datetime, BeforeValidator(parse_iso_datetime_utc)]
UniqueNonEmptyStringTuple = Annotated[
    tuple[NonEmptyStr, ...],
    Field(min_length=1),
    AfterValidator(_unique_string_tuple),
]
ModelT = TypeVar("ModelT", bound=BaseModel)


class FrozenModel(BaseModel):
    """Strict immutable Pydantic base for JSON boundary models."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
    )


class FrozenAliasModel(FrozenModel):
    """Strict immutable Pydantic base that accepts field aliases."""

    model_config = ConfigDict(populate_by_name=True)


def parse_model(model_type: type[ModelT], raw: object) -> ModelT:
    """Validate raw input and convert Pydantic errors to boundary exits."""

    try:
        return model_type.model_validate(raw)
    except ValidationError as exc:
        raise SystemExit(str(exc)) from exc


def validated_dict(
    model_type: type[ModelT],
    raw: object,
    *,
    by_alias: bool = False,
    exclude_none: bool = False,
) -> dict[str, Any]:
    """Validate raw input and return a JSON-compatible dictionary."""

    return parse_model(model_type, raw).model_dump(by_alias=by_alias, exclude_none=exclude_none, mode="json")
