"""Artifact write identity and path-safe segment helpers."""

from __future__ import annotations

from typing import Any

from pydantic import field_validator

from ...core.cycles import validate_cycle_id
from ...core.frames import validate_frame_id
from ...core.validation import FrozenModel, NonEmptyStr, Sha256Digest
from ..runs.ids import validate_run_id
from ..runs.metadata import metadata_value


def safe_segment(value: str) -> str:
    """Validate one URI path segment used in deterministic artifact paths."""

    segment = value.strip()
    if not segment:
        raise ValueError("Empty path segment")
    if segment in {".", ".."}:
        raise ValueError(f"Invalid path segment: {segment!r}")
    if "/" in segment or "\\" in segment:
        raise ValueError(f"Invalid path segment (contains path separator): {segment!r}")
    return segment


class ArtifactWorkItem(FrozenModel):
    """Write identity for one artifact in one dataset/cycle/run/frame."""

    dataset_id: NonEmptyStr
    cycle: NonEmptyStr
    run_id: NonEmptyStr
    frame_id: NonEmptyStr
    artifact_id: NonEmptyStr
    source_uri: NonEmptyStr
    code_revision: str = "unknown"
    image_identity: str = "unknown"
    product_config_digest: Sha256Digest

    @field_validator("dataset_id", "artifact_id")
    @classmethod
    def _validate_path_segment(cls, value: str) -> str:
        return safe_segment(value)

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        return validate_cycle_id(value)

    @field_validator("run_id")
    @classmethod
    def _validate_run_id(cls, value: str) -> str:
        return validate_run_id(value)

    @field_validator("frame_id")
    @classmethod
    def _validate_frame_id(cls, value: str) -> str:
        return validate_frame_id(value)

    @field_validator("code_revision", "image_identity", mode="before")
    @classmethod
    def _normalize_metadata(cls, value: Any) -> str:
        return metadata_value(value)
