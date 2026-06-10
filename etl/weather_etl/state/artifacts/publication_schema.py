"""Run publication marker contract."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import Field, field_validator

from ...core.cycles import validate_cycle_id
from ...core.validation import FrozenAliasModel, NonEmptyStr, parse_model, validated_dict
from ..runs.ids import validate_run_id
from .identity import safe_segment

PUBLICATION_SCHEMA = "weather-map.etl-run-publication"
PUBLICATION_SCHEMA_VERSION = 1


class RunPublicationMarker(FrozenAliasModel):
    """Marker written after a run manifest has been published."""

    schema_name: Literal["weather-map.etl-run-publication"] = Field(alias="schema")
    schema_version: Literal[1]
    cycle: NonEmptyStr
    dataset_id: NonEmptyStr
    run_id: NonEmptyStr
    generated_at: NonEmptyStr
    revision: NonEmptyStr
    manifest_path: NonEmptyStr

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        try:
            return validate_cycle_id(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("dataset_id")
    @classmethod
    def _validate_dataset_id(cls, value: str) -> str:
        return safe_segment(value)

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, value: str) -> str:
        return validate_run_id(value)

    @field_validator("manifest_path")
    @classmethod
    def _validate_manifest_path(cls, value: str) -> str:
        if value.startswith("/") or "://" in value:
            raise ValueError("manifest_path must be a relative artifact key")
        if any(part in {"", ".", ".."} for part in value.split("/")):
            raise ValueError("manifest_path must not contain empty, '.', or '..' segments")
        return value


def parse_run_publication(raw: Mapping[str, Any], *, uri: str | None = None) -> RunPublicationMarker:
    """Validate a raw run publication object."""

    try:
        return parse_model(RunPublicationMarker, raw)
    except SystemExit as exc:
        if uri is None:
            raise
        raise SystemExit(f"Invalid run publication {uri}: {exc}") from exc


def run_publication_marker_dict(
    *,
    cycle: str,
    dataset_id: str,
    run_id: str,
    generated_at: str,
    revision: str,
    manifest_path: str,
) -> dict[str, Any]:
    """Build the JSON object persisted as a run publication marker."""

    return validated_dict(
        RunPublicationMarker,
        {
            "schema": PUBLICATION_SCHEMA,
            "schema_version": PUBLICATION_SCHEMA_VERSION,
            "cycle": cycle,
            "dataset_id": dataset_id,
            "run_id": run_id,
            "generated_at": generated_at,
            "revision": revision,
            "manifest_path": manifest_path,
        },
        by_alias=True,
    )
