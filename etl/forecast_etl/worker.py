"""Worker orchestration for product artifact generation."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterable, Mapping

from .artifacts.json import write_json
from .artifacts.paths import ArtifactPaths, WorkItem
from .config.schema import ExecutionContext, ModelConfig, ProductSpec
from .models import acquire_prepared_source
from .proc import make_runner
from .products.execute import run_product_item_in_workdir
from .stores import make_store


def _write_success_marker(*, ctx: ExecutionContext, item: WorkItem, store, payload: Mapping[str, object]) -> None:
    """Write the per-product success marker for a completed work item."""

    ap = ArtifactPaths(ctx.artifact_root_uri)
    success_uri = ap.success_marker_uri(item)
    write_json(store=store, uri=success_uri, obj=dict(payload), indent=None)


def run_process_hour(
    *,
    ctx: ExecutionContext,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri: str | None,
    product_ids: Iterable[str],
    products: Mapping[str, ProductSpec],
) -> None:
    """Run all configured products for one (cycle, fhour)."""

    product_ids = tuple(product_ids or ())

    if not product_ids:
        raise SystemExit("No workload.products configured for process-hour")

    store = make_store()
    run = make_runner()

    with tempfile.TemporaryDirectory(prefix="forecast-work-hour-") as td:
        workdir = Path(td)
        source = acquire_prepared_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri,
            workdir=workdir,
            store=store,
        )

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
            product_metadata = run_product_item_in_workdir(
                workdir=workdir,
                ctx=ctx,
                item=item,
                product=product,
                store=store,
                source=source,
                run=run,
            )
            success_payload = {
                "cycle": item.cycle,
                "fhour": item.fhour,
                "product_id": item.product_id,
                "product": product_metadata,
            }
            _write_success_marker(ctx=ctx, item=item, store=store, payload=success_payload)
            product_done += 1

    print(
        f"Done. Published fhour bundle cycle={cycle} fhour={fhour}: "
        f"model={ctx.model_id} products={product_done}",
        flush=True,
    )
