"""Idempotent forecast manifest publisher."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping

from ..artifacts.json import read_json, write_json
from ..artifacts.paths import SUCCESS_MARKER_SUFFIX, ArtifactPaths
from ..config.schema import ExecutionContext, LayerGroup, ProductSpec
from ..stores import make_store
from ..stores.base import UriStore
from .build import build_manifest_sections, layer_groups_for_manifest
from .constants import FORECAST_BINARY_CONTRACT, MANIFEST_LAYER_GROUPS_KEY, MANIFEST_VERSION
from .revision import compute_manifest_revision


@dataclass(frozen=True)
class PublishResult:
    ready: bool
    already_published: bool
    missing_markers: tuple[str, ...] = ()


def run_publish(
    *,
    ctx: ExecutionContext,
    cycle: str,
    model_label: str,
    product_ids: Iterable[str],
    products: Mapping[str, ProductSpec],
    layer_groups: Iterable[LayerGroup] | None = None,
) -> PublishResult:
    fhours = tuple(ctx.forecast_hours or ())
    product_ids = tuple(product_ids)
    scalar_product_ids = tuple(
        product_id
        for product_id in product_ids
        if products[product_id].is_scalar
    )
    vector_product_ids = tuple(
        product_id
        for product_id in product_ids
        if products[product_id].is_vector
    )
    manifest_layer_groups = layer_groups_for_manifest(
        groups=layer_groups,
        scalar_product_ids=scalar_product_ids,
    )

    if not fhours:
        print("Publish not ready: ctx.forecast_hours is empty")
        return PublishResult(ready=False, already_published=False)

    if not product_ids:
        print("Publish not ready: workload.products is empty")
        return PublishResult(ready=False, already_published=False)

    store = make_store()
    paths = ArtifactPaths(ctx.artifact_root_uri)
    missing = _missing_success_markers(
        store=store,
        paths=paths,
        model_id=ctx.model_id,
        cycle=cycle,
        fhours=fhours,
        product_ids=product_ids,
    )
    if missing:
        print(f"Publish not ready: missing {len(missing)} success markers")
        for marker in missing[:10]:
            print(f"missing: {marker}")
        if len(missing) > 10:
            print(f"... and {len(missing) - 10} more")
        return PublishResult(ready=False, already_published=False, missing_markers=tuple(missing))

    grids, encodings, variable_meta, frames = build_manifest_sections(
        store=store,
        paths=paths,
        artifact_root_uri=ctx.artifact_root_uri,
        model_id=ctx.model_id,
        cycle=cycle,
        fhours=fhours,
        product_ids=product_ids,
        products=products,
    )

    generated_at = _utc_now_iso()
    revision = compute_manifest_revision(
        cycle=cycle,
        hours=fhours,
        scalar_product_ids=scalar_product_ids,
        layer_groups=manifest_layer_groups,
        vector_product_ids=vector_product_ids,
        grids=grids,
        encodings=encodings,
        variable_meta=variable_meta,
        frames=frames,
    )

    cycle_manifest_uri = paths.manifest_cycle_uri(model_id=ctx.model_id, cycle=cycle)
    manifest_obj = {
        "version": MANIFEST_VERSION,
        "contract": FORECAST_BINARY_CONTRACT,
        "model": ctx.model_id,
        "model_label": model_label,
        "cycle": cycle,
        "generated_at": generated_at,
        "revision": revision,
        "forecast_hours": list(fhours),
        "scalar_variables": list(scalar_product_ids),
        MANIFEST_LAYER_GROUPS_KEY: manifest_layer_groups,
        "vector_variables": list(vector_product_ids),
        "grids": grids,
        "encodings": encodings,
        "variable_meta": variable_meta,
        "frames": frames,
    }

    published_uri = paths.published_marker_uri(model_id=ctx.model_id, cycle=cycle)
    already_published = _is_already_published(
        store=store,
        published_uri=published_uri,
        cycle_manifest_uri=cycle_manifest_uri,
        revision=revision,
        cycle=cycle,
    )

    manifest_to_publish = manifest_obj
    if already_published:
        manifest_to_publish = read_json(store=store, uri=cycle_manifest_uri)
    else:
        write_json(store=store, uri=cycle_manifest_uri, obj=manifest_obj)

    _maybe_promote_latest(
        store=store,
        paths=paths,
        model_id=ctx.model_id,
        cycle=cycle,
        manifest_obj=manifest_to_publish,
    )

    if not already_published:
        write_json(
            store=store,
            uri=published_uri,
            obj={
                "cycle": cycle,
                "model": ctx.model_id,
                "generated_at": generated_at,
                "revision": revision,
                "manifest_uri": cycle_manifest_uri,
            },
        )

    print(f"Published: {cycle_manifest_uri}")
    return PublishResult(ready=True, already_published=already_published)


def _missing_success_markers(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    model_id: str,
    cycle: str,
    fhours: Iterable[str],
    product_ids: Iterable[str],
) -> list[str]:
    prefix = paths.status_prefix_uri(model_id=model_id, cycle=cycle)
    existing = {uri for uri in store.list_prefix(prefix_uri=prefix) if uri.endswith(SUCCESS_MARKER_SUFFIX)}
    expected = {
        paths.success_marker_uri_parts(model_id=model_id, cycle=cycle, fhour=fhour, layer=product_id)
        for product_id in product_ids
        for fhour in fhours
    }
    return sorted(expected - existing)


def _is_already_published(
    *,
    store: UriStore,
    published_uri: str,
    cycle_manifest_uri: str,
    revision: str,
    cycle: str,
) -> bool:
    if not store.exists(uri=published_uri):
        return False

    previous = read_json(store=store, uri=published_uri)
    previous_revision = str(previous.get("revision", "")).strip()
    if previous_revision == revision and store.exists(uri=cycle_manifest_uri):
        print(f"Already published (same revisions): {published_uri}")
        return True

    print(
        "Publish marker exists but revision differs; republishing.\n"
        f"  cycle={cycle}\n"
        f"  prev_revision={previous_revision!r}\n"
        f"  new_revision={revision!r}\n"
        f"  marker={published_uri}"
    )
    return False


def _maybe_promote_latest(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    model_id: str,
    cycle: str,
    manifest_obj: dict,
) -> None:
    latest_manifest_uri = paths.manifest_latest_uri(model_id=model_id)
    current_latest_cycle = _read_latest_cycle(store=store, latest_manifest_uri=latest_manifest_uri)
    if current_latest_cycle is None or cycle >= current_latest_cycle:
        write_json(store=store, uri=latest_manifest_uri, obj=manifest_obj)
        return

    print(
        "Skipping latest manifest promotion for older cycle.\n"
        f"  cycle={cycle}\n"
        f"  current_latest_cycle={current_latest_cycle}"
    )


def _read_latest_cycle(*, store: UriStore, latest_manifest_uri: str) -> str | None:
    if not store.exists(uri=latest_manifest_uri):
        return None

    try:
        latest = read_json(store=store, uri=latest_manifest_uri)
    except Exception as exc:
        print(f"Unable to read current latest manifest {latest_manifest_uri}: {exc}")
        return None

    cycle_raw = latest.get("cycle")
    if isinstance(cycle_raw, str) and cycle_raw.strip():
        return cycle_raw.strip()
    return None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
