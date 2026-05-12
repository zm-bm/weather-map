"""Published-cycle marker contract."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import field_validator

from ..validation import FrozenModel, NonEmptyStr, parse_model, validated_dict


class PublishedMarker(FrozenModel):
    """Marker written after a cycle manifest has been published."""

    cycle: NonEmptyStr
    model: NonEmptyStr
    generated_at: NonEmptyStr
    revision: NonEmptyStr
    manifest_uri: NonEmptyStr

    @field_validator("cycle")
    @classmethod
    def _validate_cycle(cls, value: str) -> str:
        if len(value) != 10 or not value.isdigit():
            raise ValueError("cycle must be YYYYMMDDHH")
        return value


def parse_published_marker(raw: Mapping[str, Any], *, uri: str | None = None) -> PublishedMarker:
    """Validate a raw published marker object."""

    try:
        return parse_model(PublishedMarker, raw)
    except SystemExit as exc:
        if uri is None:
            raise
        raise SystemExit(f"Invalid published marker {uri}: {exc}") from exc


def published_marker_dict(
    *,
    cycle: str,
    model: str,
    generated_at: str,
    revision: str,
    manifest_uri: str,
) -> dict[str, Any]:
    """Build the JSON object persisted as a published-cycle marker."""

    return validated_dict(
        PublishedMarker,
        {
            "cycle": cycle,
            "model": model,
            "generated_at": generated_at,
            "revision": revision,
            "manifest_uri": manifest_uri,
        },
    )
