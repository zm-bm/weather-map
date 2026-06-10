"""Pydantic models for emitted frontend manifests."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ...core.timestamps import parse_iso_datetime_utc
from ...core.validation import (
    FiniteNumber,
    FrozenAliasModel,
    FrozenModel,
    HexSha256,
    NonEmptyStr,
    NonNegativeInt,
    PositiveInt,
    UniqueNonEmptyStringTuple,
    parse_model,
)


class ManifestFrame(FrozenModel):
    """One frame pointing at a payload."""

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
    payload_file: NonEmptyStr
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

    @field_validator("generated_at")
    @classmethod
    def _validate_generated_at(cls, value: str) -> str:
        parse_iso_datetime_utc(value)
        return value

    @property
    def generated_at_utc(self) -> datetime:
        return parse_iso_datetime_utc(self.generated_at)


class ManifestDatasetIdentity(FrozenModel):
    id: NonEmptyStr
    label: NonEmptyStr


class CycleManifest(FrozenAliasModel):
    """Top-level public cycle manifest."""

    schema_name: Literal["weather-map.dataset-cycle-manifest"] = Field(alias="schema")
    schema_version: Literal[7]
    payload_contract: Literal["field-binary-v2"]
    dataset: ManifestDatasetIdentity
    run: ManifestRun
    frames: tuple[ManifestFrameEntry, ...] = Field(min_length=1)
    artifacts: dict[NonEmptyStr, ManifestArtifact] = Field(min_length=1)

    @property
    def dataset_id(self) -> str:
        return self.dataset.id

    @property
    def cycle(self) -> str:
        return self.run.cycle

    @property
    def run_id(self) -> str:
        return self.run.run_id

    @property
    def revision(self) -> str:
        return self.run.revision

    @property
    def generated_at_utc(self) -> datetime:
        return self.run.generated_at_utc

    def to_stored_dict(self) -> dict[str, object]:
        """Return the JSON object stored at public manifest paths."""

        return self.model_dump(by_alias=True, exclude_none=True, mode="json")


def parse_cycle_manifest(raw: object, *, uri: str | None = None) -> CycleManifest:
    """Validate one stored public cycle manifest."""

    try:
        return parse_model(CycleManifest, raw)
    except SystemExit as exc:
        if uri is None:
            raise
        raise SystemExit(f"Invalid cycle manifest {uri}: {exc}") from exc
