"""Pydantic success marker contract."""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING, Any, Literal, Mapping

from pydantic import Field, ValidationError, field_validator

from ...core.cycles import validate_cycle_id
from ...core.frames import validate_frame_id
from ...core.validation import (
    FiniteNumber,
    FrozenAliasModel,
    FrozenModel,
    HexSha256,
    NonEmptyStr,
    PositiveInt,
    Sha256Digest,
    UniqueNonEmptyStringTuple,
    parse_model,
    validated_dict,
)
from ..runs.ids import validate_run_id
from ..runs.metadata import metadata_value
from .identity import safe_segment

if TYPE_CHECKING:
    from ...config.pipeline import ArtifactSpec

SUCCESS_MARKER_SCHEMA = "weather-map.etl-artifact-success"
SUCCESS_MARKER_SCHEMA_VERSION = 2


class _MarkerGridMetadata(FrozenModel):
    crs: NonEmptyStr
    nx: PositiveInt
    ny: PositiveInt
    lon0: FiniteNumber
    lat0: FiniteNumber
    dx: FiniteNumber
    dy: FiniteNumber
    origin: NonEmptyStr
    layout: NonEmptyStr
    x_wrap: NonEmptyStr
    y_mode: NonEmptyStr


class ArtifactMarkerPayload(FrozenModel):
    """Artifact success-marker payload used by manifest publishing."""

    payload_uri: NonEmptyStr
    byte_length: PositiveInt
    sha256: HexSha256
    format: NonEmptyStr
    encoding_id: NonEmptyStr
    units: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    grid_id: NonEmptyStr
    grid: dict[str, Any]
    components: UniqueNonEmptyStringTuple

    @field_validator("grid")
    @classmethod
    def _validate_grid(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            return _MarkerGridMetadata.model_validate(value).model_dump(mode="json")
        except ValidationError as exc:
            raise ValueError(str(exc)) from exc


class StoredArtifactSuccessMarker(FrozenAliasModel):
    """Success marker JSON persisted for one artifact, cycle, and frame."""

    schema_name: Literal["weather-map.etl-artifact-success"] = Field(alias="schema")
    schema_version: Literal[2]
    artifact: ArtifactMarkerPayload
    dataset_id: NonEmptyStr
    cycle: NonEmptyStr
    run_id: NonEmptyStr
    frame_id: NonEmptyStr
    artifact_id: NonEmptyStr
    generated_at: NonEmptyStr
    code_revision: NonEmptyStr = "unknown"
    image_identity: NonEmptyStr = "unknown"
    product_config_digest: Sha256Digest

    @field_validator("dataset_id", "artifact_id")
    @classmethod
    def _validate_path_segment(cls, value: str) -> str:
        return safe_segment(value)

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        try:
            return validate_cycle_id(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, value: str) -> str:
        try:
            return validate_run_id(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("frame_id")
    @classmethod
    def _validate_frame_id(cls, value: str) -> str:
        try:
            return validate_frame_id(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("code_revision", "image_identity")
    @classmethod
    def _normalize_metadata(cls, value: str) -> str:
        return metadata_value(value)


class ArtifactSuccessMarker(StoredArtifactSuccessMarker):
    """Success marker read from storage, including its storage URI."""

    uri: NonEmptyStr


def parse_artifact_success_marker(raw: Mapping[str, Any], *, uri: str) -> ArtifactSuccessMarker:
    """Validate a raw success marker object and attach its storage URI."""

    if not isinstance(raw, Mapping):
        return parse_model(ArtifactSuccessMarker, raw)
    if "uri" in raw:
        raise SystemExit(f"Success marker contains unexpected field 'uri': {uri}")
    return parse_model(ArtifactSuccessMarker, {"uri": uri, **dict(raw)})


def stored_artifact_success_marker_dict(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and dump success marker JSON before writing it."""

    return validated_dict(StoredArtifactSuccessMarker, raw, by_alias=True)


def build_artifact_marker_payload(
    *,
    artifact: ArtifactSpec,
    payload_uri: str,
    payload: bytes,
    grid_id: str,
    grid: dict[str, Any],
) -> dict[str, Any]:
    """Build and validate marker metadata for one artifact payload."""

    return validated_dict(ArtifactMarkerPayload, {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "format": artifact.encoding.format,
        "encoding_id": artifact.encoding.id,
        "units": artifact.units,
        "parameter": artifact.parameter,
        "level": artifact.level,
        "components": artifact.component_ids,
        "grid_id": grid_id,
        "grid": grid,
    })
