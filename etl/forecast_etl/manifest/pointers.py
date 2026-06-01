"""Stable public manifest pointer contracts."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import Field, field_validator

from ..run_ids import validate_run_id
from ..validation import FrozenAliasModel, NonEmptyStr, parse_model, validated_dict

LATEST_POINTER_SCHEMA = "weather-map.model-latest-pointer"
CURRENT_POINTER_SCHEMA = "weather-map.model-cycle-current-pointer"
POINTER_SCHEMA_VERSION = 1

PointerSchema = Literal["weather-map.model-latest-pointer", "weather-map.model-cycle-current-pointer"]


class ModelManifestPointer(FrozenAliasModel):
    """Small public alias pointing at an immutable public run manifest."""

    schema_name: PointerSchema = Field(alias="schema")
    schema_version: Literal[1] = Field(alias="schemaVersion")
    model: NonEmptyStr
    cycle: NonEmptyStr
    run_id: NonEmptyStr = Field(alias="runId")
    revision: NonEmptyStr
    generated_at: NonEmptyStr = Field(alias="generatedAt")
    manifest_path: NonEmptyStr = Field(alias="manifestPath")

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        if len(value) != 10 or not value.isdigit():
            raise ValueError("cycle must be YYYYMMDDHH")
        return value

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, value: str) -> str:
        return validate_run_id(value)

    @field_validator("manifest_path")
    @classmethod
    def _validate_manifest_path(cls, value: str) -> str:
        if value.startswith("/") or "://" in value:
            raise ValueError("manifestPath must be a relative artifact key")
        if any(part in {"", ".", ".."} for part in value.split("/")):
            raise ValueError("manifestPath must not contain empty, '.', or '..' segments")
        return value


def manifest_pointer_dict(
    *,
    schema_name: PointerSchema,
    model_id: str,
    cycle: str,
    run_id: str,
    revision: str,
    generated_at: str,
    manifest_path: str,
) -> dict[str, Any]:
    """Build a validated public manifest pointer dictionary."""

    return validated_dict(
        ModelManifestPointer,
        {
            "schema": schema_name,
            "schemaVersion": POINTER_SCHEMA_VERSION,
            "model": model_id,
            "cycle": cycle,
            "runId": run_id,
            "revision": revision,
            "generatedAt": generated_at,
            "manifestPath": manifest_path,
        },
        by_alias=True,
    )


def parse_manifest_pointer(
    raw: Mapping[str, Any],
    *,
    expected_schema: str | None = None,
    uri: str | None = None,
) -> ModelManifestPointer:
    """Validate one public manifest pointer."""

    try:
        pointer = parse_model(ModelManifestPointer, raw)
    except SystemExit as exc:
        if uri is None:
            raise
        raise SystemExit(f"Invalid manifest pointer {uri}: {exc}") from exc

    if expected_schema is not None and pointer.schema_name != expected_schema:
        message = f"manifest pointer schema mismatch: expected={expected_schema!r} found={pointer.schema_name!r}"
        if uri is not None:
            message = f"{message} uri={uri}"
        raise SystemExit(message)
    return pointer


def is_manifest_pointer(raw: object) -> bool:
    """Return whether a raw JSON object declares a known manifest pointer schema."""

    if not isinstance(raw, Mapping):
        return False
    return raw.get("schema") in {LATEST_POINTER_SCHEMA, CURRENT_POINTER_SCHEMA}
