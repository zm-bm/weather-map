"""Pydantic success marker contract."""

from __future__ import annotations

import hashlib
from typing import Any, Mapping

from pydantic import field_validator

from ..config.resolved import ArtifactSpec
from ..run_ids import validate_run_id
from ..run_metadata import metadata_value
from ..validation import (
    FiniteNumber,
    FrozenModel,
    HexSha256,
    NonEmptyStr,
    PositiveInt,
    UniqueNonEmptyStringTuple,
    parse_model,
    validated_dict,
    validator_dict,
)


class _MarkerGrid(FrozenModel):
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
        return validator_dict(_MarkerGrid, value)


class StoredArtifactSuccessMarker(FrozenModel):
    """Success marker JSON persisted for one artifact, cycle, and forecast hour."""

    artifact: ArtifactMarkerPayload
    dataset_id: NonEmptyStr = "unknown"
    cycle: NonEmptyStr
    run_id: NonEmptyStr
    frame_id: NonEmptyStr
    artifact_id: NonEmptyStr
    code_revision: NonEmptyStr = "unknown"
    image_identity: NonEmptyStr = "unknown"
    config_digest: NonEmptyStr = "unknown"

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, value: str) -> str:
        try:
            return validate_run_id(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("code_revision", "image_identity", "config_digest")
    @classmethod
    def _normalize_metadata(cls, value: str) -> str:
        return metadata_value(value)


class ArtifactSuccessMarker(StoredArtifactSuccessMarker):
    """Success marker read from storage, including its storage URI."""

    uri: NonEmptyStr


def parse_artifact_success_marker_model(raw: Mapping[str, Any], *, uri: str) -> ArtifactSuccessMarker:
    """Validate success marker JSON and attach its storage URI."""

    if not isinstance(raw, Mapping):
        return parse_model(ArtifactSuccessMarker, raw)
    if "uri" in raw:
        raise SystemExit(f"Success marker contains unexpected field 'uri': {uri}")
    return parse_model(ArtifactSuccessMarker, {"uri": uri, **dict(raw)})


def parse_artifact_success_marker(raw: Mapping[str, Any], *, uri: str) -> ArtifactSuccessMarker:
    """Validate a raw success marker object from the given marker URI."""

    return parse_artifact_success_marker_model(raw, uri=uri)


def artifact_success_marker_dict(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and dump success marker JSON before writing it."""

    return validated_dict(StoredArtifactSuccessMarker, raw)


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
