"""Pydantic models for emitted frontend manifests."""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..validation import (
    FiniteNumber,
    FrozenAliasModel,
    FrozenModel,
    HexSha256,
    NonEmptyStr,
    NonNegativeInt,
    PositiveInt,
    UniqueNonEmptyStringTuple,
    validated_dict,
)


class ManifestFrame(FrozenModel):
    """One frame pointing at a field payload."""

    path: NonEmptyStr
    byte_length: PositiveInt
    sha256: HexSha256


class ManifestGrid(FrozenModel):
    """Grid metadata exposed to frontend field decoders."""

    id: NonEmptyStr
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


class ManifestEncoding(BaseModel):
    """Permissive artifact encoding metadata emitted to the frontend."""

    model_config = ConfigDict(
        extra="allow",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
    )

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr


class ManifestArtifact(FrozenModel):
    """Frontend artifact entry with frames keyed by frame id."""

    id: NonEmptyStr
    kind: Literal["scalar", "vector"]
    units: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    components: UniqueNonEmptyStringTuple
    grid: ManifestGrid
    encoding: ManifestEncoding
    frames: dict[NonEmptyStr, ManifestFrame] = Field(min_length=1)
    payload_file: NonEmptyStr | None = None
    temporal_kind: NonEmptyStr | None = None
    source_interval_hours: FiniteNumber | None = None

    @model_validator(mode="after")
    def _valid_temporal_interval(self) -> "ManifestArtifact":
        if self.source_interval_hours is not None and self.source_interval_hours <= 0:
            raise ValueError("source_interval_hours must be positive when provided")
        return self


class ManifestFrameEntry(FrozenModel):
    id: NonEmptyStr
    lead_hours: NonNegativeInt
    valid_at: NonEmptyStr


class ManifestRun(FrozenModel):
    cycle: NonEmptyStr
    run_id: NonEmptyStr
    payload_root: NonEmptyStr
    generated_at: NonEmptyStr
    revision: NonEmptyStr


class ManifestDatasetIdentity(FrozenModel):
    id: NonEmptyStr
    label: NonEmptyStr


class CycleManifest(FrozenAliasModel):
    """Top-level internal cycle manifest."""

    schema_name: Literal["weather-map.dataset-cycle-manifest"] = Field(alias="schema")
    schema_version: Literal[6]
    payload_contract: Literal["field-binary-v2"]
    dataset: ManifestDatasetIdentity
    run: ManifestRun
    frames: tuple[ManifestFrameEntry, ...] = Field(min_length=1)
    artifacts: dict[NonEmptyStr, dict[str, Any]] = Field(min_length=1)


def manifest_frame(*, path: str, byte_length: int, sha256: str) -> dict[str, Any]:
    """Build a validated manifest frame dictionary."""

    return validated_dict(
        ManifestFrame,
        {
            "path": path,
            "byte_length": byte_length,
            "sha256": sha256,
        },
    )


def manifest_grid(*, grid_id: str, grid: Mapping[str, Any]) -> dict[str, Any]:
    """Translate marker grid metadata to frontend manifest keys."""

    return validated_dict(
        ManifestGrid,
        {
            "id": grid_id,
            "crs": grid["crs"],
            "nx": grid["nx"],
            "ny": grid["ny"],
            "lon0": grid["lon0"],
            "lat0": grid["lat0"],
            "dx": grid["dx"],
            "dy": grid["dy"],
            "origin": grid["origin"],
            "layout": grid["layout"],
            "x_wrap": grid["x_wrap"],
            "y_mode": grid["y_mode"],
        },
    )


def manifest_encoding(*, encoding_id: str, encoding: Mapping[str, Any]) -> dict[str, Any]:
    """Translate internal encoding metadata to frontend manifest keys."""

    raw: dict[str, Any] = {"id": encoding_id}
    for key, value in encoding.items():
        raw[key] = value
    return validated_dict(ManifestEncoding, raw)


def manifest_time(*, frame_id: str, lead_hours: int, valid_at: str) -> dict[str, Any]:
    """Build a validated frame manifest entry."""

    return validated_dict(
        ManifestFrameEntry,
        {
            "id": frame_id,
            "lead_hours": lead_hours,
            "valid_at": valid_at,
        },
    )


def cycle_manifest(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and dump the top-level cycle manifest."""

    return validated_dict(CycleManifest, raw, by_alias=True)
