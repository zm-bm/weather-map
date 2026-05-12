"""Status artifact helpers for forecast cycles."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from ..config.resolved import ModelConfig
from ..storage.base import UriObject, UriStore
from .markers_schema import parse_product_success_marker
from .paths import PUBLISHED_MARKER_FILENAME, SUCCESS_MARKER_SUFFIX, ArtifactPaths
from .repository import ArtifactRepository

DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT = 5
DEFAULT_MISSING_SAMPLE_LIMIT = 12


@dataclass(frozen=True)
class _ArtifactListing:
    key: str
    uri: str
    last_modified: datetime | None


@dataclass(frozen=True)
class CycleProgress:
    """Computed progress for one model cycle from status artifacts."""

    cycle: str
    published: bool
    manifest_present: bool
    expected_markers: int
    found_markers: int
    missing_markers: int
    last_progress_at: datetime | None
    missing_sample: tuple[str, ...]
    invalid_marker_sample: tuple[str, ...]

    @property
    def complete(self) -> bool:
        return self.expected_markers > 0 and self.missing_markers == 0 and not self.invalid_marker_sample


def expected_success_marker_ids(*, product_ids: Iterable[str], fhours: Iterable[str]) -> set[str]:
    """Return expected status marker ids as {product_id}/{fhour}."""

    return {f"{product_id}/{fhour}" for product_id in product_ids for fhour in fhours}


def success_marker_id_from_key(*, model_id: str, cycle: str, key: str) -> str | None:
    """Return {product_id}/{fhour} for a success marker key, or None."""

    parts = key.split("/")
    if len(parts) != 5:
        return None
    status_part, key_model, key_cycle, product_id, filename = parts
    if status_part != "status" or key_model != model_id or key_cycle != cycle:
        return None
    if not filename.endswith(SUCCESS_MARKER_SUFFIX):
        return None
    fhour = filename[: -len(SUCCESS_MARKER_SUFFIX)]
    if not fhour:
        return None
    return f"{product_id}/{fhour}"


def published_marker_key(*, model_id: str, cycle: str) -> str:
    return f"status/{model_id}/{cycle}/{PUBLISHED_MARKER_FILENAME}"


def is_published_marker_key(*, model_id: str, cycle: str, key: str) -> bool:
    return key == published_marker_key(model_id=model_id, cycle=cycle)


def summarize_cycle_progress(
    *,
    artifact_root_uri: str,
    model_id: str,
    cycle: str,
    product_ids: Iterable[str],
    fhours: Iterable[str],
    objects: Iterable[UriObject],
    read_json: Callable[[str], Mapping[str, Any]],
    manifest_present: bool = False,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> CycleProgress:
    """Summarize marker progress from listed status artifacts."""

    paths = ArtifactPaths(artifact_root_uri)
    listed = tuple(
        _ArtifactListing(
            key=paths.relative_key(obj.uri),
            uri=obj.uri,
            last_modified=obj.last_modified,
        )
        for obj in objects
    )
    published = any(is_published_marker_key(model_id=model_id, cycle=cycle, key=obj.key) for obj in listed)
    marker_objects = [obj for obj in listed if obj.key.endswith(SUCCESS_MARKER_SUFFIX)]
    marker_by_id = {
        marker_id: obj
        for obj in marker_objects
        for marker_id in [success_marker_id_from_key(model_id=model_id, cycle=cycle, key=obj.key)]
        if marker_id is not None
    }

    expected = expected_success_marker_ids(product_ids=product_ids, fhours=fhours)
    found = set(marker_by_id) & expected
    missing = sorted(expected - found)
    invalid = _invalid_marker_sample(
        read_json=read_json,
        marker_by_id=marker_by_id,
        found=found,
        limit=marker_validation_sample_limit,
    )
    last_progress_at = _latest_modified(
        obj.last_modified
        for obj in listed
        if obj.key.endswith(SUCCESS_MARKER_SUFFIX) or is_published_marker_key(model_id=model_id, cycle=cycle, key=obj.key)
    )

    return CycleProgress(
        cycle=cycle,
        published=published,
        manifest_present=manifest_present,
        expected_markers=len(expected),
        found_markers=len(found),
        missing_markers=len(missing),
        last_progress_at=last_progress_at,
        missing_sample=tuple(missing[:missing_sample_limit]),
        invalid_marker_sample=tuple(invalid),
    )


def read_cycle_progress(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    model: ModelConfig,
    cycle: str,
    manifest_present: bool = False,
    missing_sample_limit: int = DEFAULT_MISSING_SAMPLE_LIMIT,
    marker_validation_sample_limit: int = DEFAULT_MARKER_VALIDATION_SAMPLE_LIMIT,
) -> CycleProgress:
    """Read and summarize one model cycle's status artifacts."""

    artifacts = ArtifactRepository(store=store, paths=paths)
    return summarize_cycle_progress(
        artifact_root_uri=paths.artifact_root_uri,
        model_id=model.id,
        cycle=cycle,
        product_ids=model.workload.products,
        fhours=model.workload.forecast_hours,
        objects=artifacts.list_status_objects(model_id=model.id, cycle=cycle),
        read_json=artifacts.read_json_uri,
        manifest_present=manifest_present,
        missing_sample_limit=missing_sample_limit,
        marker_validation_sample_limit=marker_validation_sample_limit,
    )


def _invalid_marker_sample(
    *,
    read_json: Callable[[str], Mapping[str, Any]],
    marker_by_id: dict[str, _ArtifactListing],
    found: set[str],
    limit: int,
) -> list[str]:
    invalid: list[str] = []
    for marker_id in sorted(found)[:limit]:
        obj = marker_by_id[marker_id]
        try:
            parse_product_success_marker(read_json(obj.uri), uri=obj.uri)
        except (Exception, SystemExit):
            invalid.append(marker_id)
    return invalid


def _latest_modified(values: Iterable[datetime | None]) -> datetime | None:
    concrete = [value for value in values if value is not None]
    return max(concrete) if concrete else None
