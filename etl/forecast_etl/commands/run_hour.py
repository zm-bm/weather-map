"""Run one forecast hour through source acquisition and product generation."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterable, Mapping

from ..artifacts.markers_schema import build_product_marker_payload
from ..artifacts.paths import WorkItem
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ModelConfig, ProductSpec
from ..encoding.product_payload import encode_product_payload
from ..extract.grib import grid_meta_from_grib
from ..extract.product_bands import extract_product_bands
from ..proc import RunFn, make_runner
from ..runtime import ExecutionContext
from ..source_adapters import acquire_prepared_source
from ..storage.base import UriStore
from ..storage.routing import make_store
from .publish_cycle import publish_cycle


def run_process_hour(
    *,
    ctx: ExecutionContext,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri: str | None,
    product_ids: Iterable[str],
    products: Mapping[str, ProductSpec],
    store: UriStore,
    artifacts: ArtifactRepository,
    run: RunFn,
) -> None:
    """Run all configured products for one (cycle, fhour)."""

    product_ids = tuple(product_ids or ())

    if not product_ids:
        raise SystemExit("No workload.products configured for process-hour")

    with tempfile.TemporaryDirectory(prefix="forecast-work-hour-") as td:
        workdir = Path(td)
        source = acquire_prepared_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri,
            workdir=workdir,
            store=store,
            run=run,
        )
        grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=run)

        product_done = 0
        for product_id in product_ids:
            product = products.get(product_id)
            if product is None:
                raise SystemExit(f"Unknown product in workload.products: {product_id}")

            item = WorkItem(
                model_id=ctx.model_id,
                cycle=cycle,
                fhour=fhour,
                source_uri=source.uri,
                product_id=str(product_id),
            )
            bands = extract_product_bands(
                product=product,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                fhour=fhour,
            )
            payload = encode_product_payload(product=product, grid=grid, bands=bands)
            payload_uri = artifacts.write_field_payload(item=item, dtype=product.encoding.dtype, payload=payload)
            product_marker_payload = build_product_marker_payload(
                product=product,
                payload_uri=payload_uri,
                payload=payload,
                grid_id=source.grid_id,
                grid=grid,
            )
            artifacts.write_success_marker(item=item, product=product_marker_payload)
            product_done += 1

    print(
        f"Done. Published fhour bundle cycle={cycle} fhour={fhour}: "
        f"model={ctx.model_id} products={product_done}",
        flush=True,
    )


def run_hour(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    fhour: str,
    source_uri: str | None,
    publish: bool,
    store: UriStore | None = None,
    run: RunFn | None = None,
) -> None:
    """Process one forecast hour and optionally publish the cycle."""

    resolved_store = store if store is not None else make_store()
    artifacts = ArtifactRepository.for_root(store=resolved_store, artifact_root_uri=ctx.artifact_root_uri)
    resolved_run = run if run is not None else make_runner()
    run_process_hour(
        ctx=ctx,
        model=model,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        product_ids=model.workload.products,
        products=model.products,
        store=resolved_store,
        artifacts=artifacts,
        run=resolved_run,
    )
    if publish:
        publish_cycle(ctx=ctx, model=model, cycle=cycle, store=resolved_store)
