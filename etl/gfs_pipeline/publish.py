"""Publish role: idempotent readiness check + manifest writer.

Behavior:
- Compute expected success markers for ctx.forecast_hours.
- If any are missing: return not-ready.
- If all present and `_PUBLISHED.json` exists with SAME revision: return already-published.
- If `_PUBLISHED.json` exists with DIFFERENT revision: republish (overwrite manifests + marker).
- Else: write manifests similar to legacy etl/manifest.py and write `_PUBLISHED.json`.

This module performs no direct filesystem/S3 operations; all I/O goes through
the UriStore interface.
"""

from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Any

from .stores import make_store
from .stores.base import UriStore
from .config import ExecutionContext
from .contracts import ArtifactPaths, SUCCESS_MARKER_SUFFIX
from .layout import parse_cycle


def _utc_now_iso() -> str:
    """Current UTC timestamp as ISO-8601 string (seconds precision)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _compute_revision(*, cycle: str, hours: Iterable[str], layers: Iterable[str], min_zoom: int, max_zoom: int) -> str:
    """Compute a stable, short revision string for published manifests."""
    basis = {
        "cycle": cycle,
        "forecast_hours": list(hours),
        "layers": list(layers),
        "min_zoom": int(min_zoom),
        "max_zoom": int(max_zoom),
    }
    digest = hashlib.sha256(json.dumps(basis, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]


def _list_success_markers(*, store: UriStore, ap: ArtifactPaths, cycle: str) -> set[str]:
    prefix = ap.status_prefix_uri(cycle=cycle)
    uris = store.list_prefix(prefix_uri=prefix)
    return {u for u in uris if u.endswith(SUCCESS_MARKER_SUFFIX)}


def _expected_success_markers(
    *,
    ap: ArtifactPaths,
    cycle: str,
    fhours: Iterable[str],
    layers: Iterable[str],
) -> set[str]:
    expected: set[str] = set()
    for layer in layers:
        for fhour in fhours:
            expected.add(ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=layer))
    return expected


def _write_json(*, store: UriStore, uri: str, obj: dict) -> None:
    store.write_bytes(
        uri=uri,
        data=(json.dumps(obj, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )


def _read_json(*, store: UriStore, uri: str) -> dict[str, Any]:
    data = store.read_bytes(uri=uri)
    return json.loads(data.decode("utf-8"))


@dataclass(frozen=True)
class PublishResult:
    ready: bool
    already_published: bool
    missing_markers: tuple[str, ...] = ()


def run_publish(*, ctx: ExecutionContext, cycle: str, layers: Iterable[str]) -> PublishResult:
    fhours = tuple(ctx.forecast_hours or ())
    layers = tuple(layers)

    if not fhours:
        print("Publish not ready: ctx.forecast_hours is empty")
        return PublishResult(ready=False, already_published=False)

    if not layers:
        print("Publish not ready: layers is empty")
        return PublishResult(ready=False, already_published=False)

    store = make_store()
    ap = ArtifactPaths(ctx.artifact_root_uri)

    # Check for expected success markers
    existing = _list_success_markers(store=store, ap=ap, cycle=cycle)
    expected = _expected_success_markers(ap=ap, cycle=cycle, fhours=fhours, layers=layers)
    missing = sorted(expected - existing)

    # If any markers are missing, exit not-ready
    if missing:
        print(f"Publish not ready: missing {len(missing)} success markers")
        for m in missing[:10]:
            print(f"missing: {m}")
        if len(missing) > 10:
            print(f"... and {len(missing) - 10} more")
        return PublishResult(ready=False, already_published=False, missing_markers=tuple(missing))

    generated_at = _utc_now_iso()
    revision = _compute_revision(
        cycle=cycle,
        hours=fhours,
        layers=layers,
        min_zoom=ctx.gdal.min_zoom,
        max_zoom=ctx.gdal.max_zoom,
    )

    # All markers present; check published marker
    published_uri = ap.published_marker_uri(cycle=cycle)
    if store.exists(uri=published_uri):
        prev = _read_json(store=store, uri=published_uri)
        prev_rev = str(prev.get("revision", "")).strip()
        if prev_rev == revision:
            print(f"Already published (same revision): {published_uri}")
            return PublishResult(ready=True, already_published=True)

        print(
            "Publish marker exists but revision differs; republishing.\n"
            f"  cycle={cycle}\n"
            f"  prev_revision={prev_rev!r}\n"
            f"  new_revision={revision!r}\n"
            f"  marker={published_uri}"
        )

    # Write cycle manifest (used to drive frontend).
    cycle_manifest_uri = ap.manifest_cycle_uri(cycle=cycle)
    cycle_date, cycle_hour = parse_cycle(cycle)
    _write_json(
        store=store,
        uri=cycle_manifest_uri,
        obj={
            "version": 1,
            "cycle": cycle,
            "cycle_date": cycle_date,
            "cycle_hour": cycle_hour,
            "generated_at": generated_at,
            "revision": revision,
            "forecast_hours": list(fhours),
            "layers": list(layers),
            "min_zoom": ctx.gdal.min_zoom,
            "max_zoom": ctx.gdal.max_zoom,
        },
    )

    # Overwrite latest manifest (loaded by frontend to find most recent cycle).
    latest_manifest_uri = ap.manifest_latest_uri()
    _write_json(
        store=store,
        uri=latest_manifest_uri,
        obj={
            "cycle": cycle,
            "generated_at": generated_at,
            "revision": revision,
        },
    )

    # Write publish marker last (signals publish completion).
    _write_json(
        store=store,
        uri=published_uri,
        obj={
            "cycle": cycle,
            "generated_at": generated_at,
            "revision": revision,
            "manifest_uri": cycle_manifest_uri,
        },
    )

    print(f"Published: {cycle_manifest_uri}")
    return PublishResult(ready=True, already_published=False)
