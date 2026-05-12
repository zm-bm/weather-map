"""Read-only helpers for inspecting published manifests."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..artifacts.paths import ArtifactPaths
from ..artifacts.repository import ArtifactRepository
from ..storage.base import UriStore
from ..validation import NonEmptyStr


class _ManifestRunProjection(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
    )

    cycle: str | None = None
    generated_at: datetime | None = Field(default=None, alias="generatedAt")
    revision: str | None = None

    @field_validator("cycle", "revision", mode="before")
    @classmethod
    def _optional_non_empty_string(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("generated_at", mode="before")
    @classmethod
    def _parse_generated_at(cls, value: object) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            return _utc(value)
        if not isinstance(value, str):
            return None
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return _utc(datetime.fromisoformat(stripped.replace("Z", "+00:00")))
        except ValueError:
            return None


class ManifestInfo(BaseModel):
    """Tolerant manifest summary used by artifact consumers."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
    )

    cycle: NonEmptyStr
    generated_at: datetime | None = None
    revision: str | None = None

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        if len(value) != 10 or not value.isdigit():
            raise ValueError("cycle must be YYYYMMDDHH")
        return value


def manifest_cycle_from_key(*, model_id: str, key: str) -> str | None:
    """Return the cycle from manifests/{model}/{cycle}.json, excluding latest.json."""

    prefix = f"manifests/{model_id}/"
    if not key.startswith(prefix) or not key.endswith(".json"):
        return None
    name = key[len(prefix) : -len(".json")]
    if name == "latest":
        return None
    if len(name) == 10 and name.isdigit():
        return name
    return None


def manifest_info_from_obj(raw: Mapping[str, Any], *, fallback_cycle: str | None = None) -> ManifestInfo | None:
    """Extract tolerant run metadata from a cycle manifest object."""

    run = raw.get("run") if isinstance(raw, Mapping) else None
    if not isinstance(run, Mapping):
        run = {}

    try:
        projection = _ManifestRunProjection.model_validate(run)
    except ValidationError:
        projection = _ManifestRunProjection()

    cycle = projection.cycle or fallback_cycle
    if cycle is None:
        return None

    try:
        return ManifestInfo(
            cycle=cycle,
            generated_at=projection.generated_at,
            revision=projection.revision,
        )
    except ValidationError:
        return None


def read_latest_manifest_info(*, store: UriStore, paths: ArtifactPaths, model_id: str) -> ManifestInfo | None:
    """Read the model's latest manifest projection, if present and valid."""

    artifacts = ArtifactRepository(store=store, paths=paths)
    try:
        return manifest_info_from_obj(artifacts.read_latest_manifest(model_id=model_id))
    except FileNotFoundError:
        return None


def list_manifest_infos(*, store: UriStore, paths: ArtifactPaths, model_id: str, limit: int) -> list[ManifestInfo]:
    """Read recent cycle manifest projections newest first."""

    artifacts = ArtifactRepository(store=store, paths=paths)
    objects = artifacts.list_manifest_objects(model_id=model_id)
    cycle_objects = [
        (cycle, obj)
        for obj in objects
        for cycle in [manifest_cycle_from_key(model_id=model_id, key=paths.relative_key(obj.uri))]
        if cycle is not None
    ]
    cycle_objects.sort(key=lambda item: item[0], reverse=True)

    infos: list[ManifestInfo] = []
    for fallback_cycle, obj in cycle_objects[:limit]:
        try:
            manifest = artifacts.read_json_uri(obj.uri)
        except Exception:
            continue
        info = manifest_info_from_obj(manifest, fallback_cycle=fallback_cycle)
        if info is not None:
            infos.append(info)
    return infos


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
