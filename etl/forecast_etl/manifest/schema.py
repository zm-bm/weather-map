"""Pydantic models for emitted frontend manifests."""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..validation import (
    FiniteNumber,
    FrozenAliasModel,
    HexSha256,
    NonEmptyStr,
    NonNegativeInt,
    PositiveInt,
    UniqueNonEmptyStringTuple,
    validated_dict,
)


class ManifestFrame(FrozenAliasModel):
    """One forecast-hour frame pointing at a field payload."""

    path: NonEmptyStr
    byte_length: PositiveInt = Field(alias="byteLength")
    sha256: HexSha256


class ManifestGrid(FrozenAliasModel):
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
    x_wrap: NonEmptyStr = Field(alias="xWrap")
    y_mode: NonEmptyStr = Field(alias="yMode")


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


class ManifestArtifact(FrozenAliasModel):
    """Frontend artifact entry with frames keyed by forecast hour."""

    id: NonEmptyStr
    kind: Literal["scalar", "vector"]
    units: NonEmptyStr
    parameter: NonEmptyStr
    level: NonEmptyStr
    components: UniqueNonEmptyStringTuple
    grid: ManifestGrid
    encoding: ManifestEncoding
    frames: dict[NonEmptyStr, ManifestFrame] = Field(min_length=1)
    temporal_kind: NonEmptyStr | None = Field(default=None, alias="temporalKind")
    source_interval_hours: FiniteNumber | None = Field(default=None, alias="sourceIntervalHours")

    @model_validator(mode="after")
    def _valid_temporal_interval(self) -> "ManifestArtifact":
        if self.source_interval_hours is not None and self.source_interval_hours <= 0:
            raise ValueError("sourceIntervalHours must be positive when provided")
        return self


class ManifestTime(FrozenAliasModel):
    id: NonEmptyStr
    lead_hours: NonNegativeInt = Field(alias="leadHours")
    valid_at: NonEmptyStr = Field(alias="validAt")


class ManifestRun(FrozenAliasModel):
    cycle: NonEmptyStr
    generated_at: NonEmptyStr = Field(alias="generatedAt")
    revision: NonEmptyStr


class ManifestModelIdentity(FrozenAliasModel):
    id: NonEmptyStr
    label: NonEmptyStr


class CycleManifest(FrozenAliasModel):
    """Top-level frontend cycle manifest."""

    schema_name: Literal["weather-map.cycle-manifest"] = Field(alias="schema")
    schema_version: Literal[5] = Field(alias="schemaVersion")
    payload_contract: Literal["forecast-binary-v2"] = Field(alias="payloadContract")
    model: ManifestModelIdentity
    run: ManifestRun
    times: tuple[ManifestTime, ...] = Field(min_length=1)
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
        by_alias=True,
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
        by_alias=True,
    )


def manifest_encoding(*, encoding_id: str, encoding: Mapping[str, Any]) -> dict[str, Any]:
    """Translate internal encoding metadata to frontend manifest keys."""

    raw: dict[str, Any] = {"id": encoding_id}
    for key, value in encoding.items():
        if key == "byte_order":
            raw["byteOrder"] = value
        elif key == "decode_formula":
            raw["decodeFormula"] = value
        else:
            raw[key] = value
    return validated_dict(ManifestEncoding, raw, by_alias=True)


def manifest_time(*, fhour: str, lead_hours: int, valid_at: str) -> dict[str, Any]:
    """Build a validated forecast-time manifest entry."""

    return validated_dict(
        ManifestTime,
        {
            "id": fhour,
            "lead_hours": lead_hours,
            "valid_at": valid_at,
        },
        by_alias=True,
    )


def cycle_manifest(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and dump the top-level cycle manifest."""

    return validated_dict(CycleManifest, raw, by_alias=True)
