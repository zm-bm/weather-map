"""Read-only helpers for inspecting published manifests."""

from __future__ import annotations

from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from ..artifacts.paths import ArtifactPaths
from ..artifacts.repository import ArtifactRepository
from ..storage.base import UriObject, UriStore
from ..uris import join_uri
from ..validation import NonEmptyStr
from .pointers import LATEST_POINTER_SCHEMA, is_manifest_pointer, parse_manifest_pointer


class _ManifestRunProjection(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
    )

    cycle: str | None = None
    run_id: str | None = Field(default=None, alias="runId")
    generated_at: datetime | None = Field(default=None, alias="generatedAt")
    revision: str | None = None

    @field_validator("cycle", "run_id", "revision", mode="before")
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
    run_id: str | None = None
    generated_at: datetime | None = None
    revision: str | None = None

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        if len(value) != 10 or not value.isdigit():
            raise ValueError("cycle must be YYYYMMDDHH")
        return value


def manifest_cycle_from_key(*, model_id: str, key: str) -> str | None:
    """Return the cycle from legacy manifests or pointer-era current aliases."""

    prefix = f"manifests/{model_id}/"
    if not key.startswith(prefix) or not key.endswith(".json"):
        return None
    relative = key[len(prefix) :]
    if relative == "latest.json":
        return None

    cycles_prefix = "cycles/"
    if relative.startswith(cycles_prefix):
        parts = relative.split("/")
        if len(parts) == 3 and parts[0] == "cycles" and parts[2] == "current.json":
            cycle = parts[1]
            if len(cycle) == 10 and cycle.isdigit():
                return cycle
        return None

    name = relative[: -len(".json")]
    if len(name) == 10 and name.isdigit():
        return name
    return None


def manifest_info_from_obj(raw: Mapping[str, Any], *, fallback_cycle: str | None = None) -> ManifestInfo | None:
    """Extract tolerant run metadata from a manifest object or pointer."""

    if is_manifest_pointer(raw):
        try:
            pointer = parse_manifest_pointer(raw)
            return _manifest_info_from_pointer(pointer)
        except (Exception, SystemExit):
            return None

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
            run_id=projection.run_id,
            generated_at=projection.generated_at,
            revision=projection.revision,
        )
    except ValidationError:
        return None


def read_latest_manifest_info(*, store: UriStore, paths: ArtifactPaths, model_id: str) -> ManifestInfo | None:
    """Read the model's latest alias projection, if present and valid."""

    artifacts = ArtifactRepository(store=store, paths=paths)
    try:
        raw = artifacts.read_latest_manifest(model_id=model_id)
        if is_manifest_pointer(raw):
            pointer = parse_manifest_pointer(raw, expected_schema=LATEST_POINTER_SCHEMA)
            return _manifest_info_from_pointer(pointer)
        return manifest_info_from_obj(raw)
    except (FileNotFoundError, SystemExit):
        return None


def read_latest_manifest_object(*, artifact_repo: ArtifactRepository, model_id: str) -> dict[str, Any] | None:
    """Read and dereference a model's latest alias into a full manifest object."""

    if not artifact_repo.latest_manifest_exists(model_id=model_id):
        return None
    raw = artifact_repo.read_latest_manifest(model_id=model_id)
    if not is_manifest_pointer(raw):
        return raw
    return read_manifest_object_from_pointer(
        artifact_repo=artifact_repo,
        pointer_obj=raw,
        expected_model_id=model_id,
        expected_schema=LATEST_POINTER_SCHEMA,
    )


def read_manifest_object_from_pointer(
    *,
    artifact_repo: ArtifactRepository,
    pointer_obj: Mapping[str, Any],
    expected_model_id: str | None = None,
    expected_schema: str | None = None,
) -> dict[str, Any]:
    """Dereference one manifest pointer and require it to match the target run."""

    pointer = parse_manifest_pointer(pointer_obj, expected_schema=expected_schema)
    if expected_model_id is not None and pointer.model != expected_model_id:
        raise SystemExit(
            "manifest pointer model mismatch: "
            f"expected={expected_model_id!r} found={pointer.model!r} manifestPath={pointer.manifest_path}"
        )

    manifest_uri = join_uri(artifact_repo.paths.artifact_root_uri, [pointer.manifest_path])
    manifest = artifact_repo.read_json_uri(manifest_uri)
    info = manifest_info_from_obj(manifest)
    if info is None:
        raise SystemExit(f"manifest pointer target has no valid run metadata: {manifest_uri}")
    if info.cycle != pointer.cycle or info.run_id != pointer.run_id or info.revision != pointer.revision:
        raise SystemExit(
            "manifest pointer target mismatch: "
            f"pointer=({pointer.cycle}, {pointer.run_id}, {pointer.revision}) "
            f"target=({info.cycle}, {info.run_id}, {info.revision}) "
            f"uri={manifest_uri}"
        )
    return manifest


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

    selected = cycle_objects[:limit]
    if not selected:
        return []

    def read_info(item: tuple[str, UriObject]) -> ManifestInfo | None:
        fallback_cycle, obj = item
        try:
            manifest = artifacts.read_json_uri(obj.uri)
        except Exception:
            return None
        return manifest_info_from_obj(manifest, fallback_cycle=fallback_cycle)

    max_workers = min(8, len(selected))
    infos: list[ManifestInfo] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = executor.map(read_info, selected)
    for info in results:
        if info is not None:
            infos.append(info)
    return infos


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _manifest_info_from_pointer(pointer) -> ManifestInfo:
    return ManifestInfo(
        cycle=pointer.cycle,
        run_id=pointer.run_id,
        generated_at=_parse_optional_datetime(pointer.generated_at),
        revision=pointer.revision,
    )


def _parse_optional_datetime(value: object) -> datetime | None:
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
