"""Private JSON helpers for config documents and digests."""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..storage.base import UriStore


def canonical_json_bytes(document: dict[str, Any]) -> bytes:
    """Encode a JSON-compatible object with stable formatting."""

    return (json.dumps(dict(document), sort_keys=True, indent=2) + "\n").encode("utf-8")


def json_document_digest(document: dict[str, Any]) -> str:
    """Return a deterministic SHA-256 digest for a JSON-compatible object."""

    payload = canonical_json_bytes(document).rstrip(b"\n")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def read_json_object(
    *,
    uri: str,
    store: "UriStore",
    parse_description: str,
    object_description: str | None = None,
    object_requirement: str = "an object",
) -> dict[str, Any]:
    """Read one UTF-8 JSON object from config storage."""

    raw = store.read_bytes(uri=uri)
    try:
        text = raw.decode("utf-8")
        obj = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Failed to parse {parse_description} {uri}: {exc}") from exc
    if not isinstance(obj, dict):
        label = object_description or parse_description
        raise SystemExit(f"{label} {uri} must be {object_requirement}")
    return obj
