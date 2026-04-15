"""Worker orchestration for scalar/vector artifact generation."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any, Iterable, Mapping

from .config import ExecutionContext
from .contracts import ArtifactPaths, WorkItem
from .proc import make_runner
from .scalar_product import run_scalar_item_in_workdir
from .stores import make_store
from .vector_product import run_vector_item_in_workdir


def _write_success_marker(*, ctx: ExecutionContext, item: WorkItem, store, payload: Mapping[str, Any]) -> None:
    ap = ArtifactPaths(ctx.artifact_root_uri)
    success_uri = ap.success_marker_uri(item)
    store.write_bytes(
        uri=success_uri,
        data=(json.dumps(dict(payload), sort_keys=True) + "\n").encode("utf-8"),
    )


def _run_scalar_item(
    *,
    ctx: ExecutionContext,
    item: WorkItem,
    layer: Mapping[str, Any],
    store,
    grib_path: Path,
    workdir: Path,
    run,
) -> dict[str, Any]:
    scalar = run_scalar_item_in_workdir(
        workdir=workdir,
        ctx=ctx,
        item=item,
        layer=layer,
        store=store,
        grib_path=grib_path,
        run=run,
    )
    return {
        "cycle": item.cycle,
        "fhour": item.fhour,
        "layer": item.layer,
        "kind": "scalar",
        "scalar": scalar,
    }


def _run_vector_item(
    *,
    ctx: ExecutionContext,
    item: WorkItem,
    vector_variable: Mapping[str, Any],
    store,
    grib_path: Path,
    workdir: Path,
    run,
) -> dict[str, Any]:
    vector = run_vector_item_in_workdir(
        workdir=workdir,
        ctx=ctx,
        item=item,
        vector_variable=vector_variable,
        store=store,
        grib_path=grib_path,
        run=run,
    )
    return {
        "cycle": item.cycle,
        "fhour": item.fhour,
        "layer": item.layer,
        "kind": "vector",
        "vector": vector,
    }


def run_process_hour(
    *,
    ctx: ExecutionContext,
    cycle: str,
    fhour: str,
    source_uri: str,
    scalar_variables: Iterable[str],
    scalar_variables_cfg: Mapping[str, Mapping[str, Any]],
    vector_variables_cfg: Mapping[str, Mapping[str, Any]] | None = None,
) -> None:
    """Run all configured scalar/vector work items for one (cycle, fhour)."""
    scalar_variables = tuple(scalar_variables or ())
    vector_variables_cfg = vector_variables_cfg or {}
    vector_variables = tuple(vector_variables_cfg.keys())

    if not scalar_variables and not vector_variables:
        raise SystemExit("No scalar_variables or vector_variables configured for process-hour")

    store = make_store()
    run = make_runner()

    with tempfile.TemporaryDirectory(prefix="gfs-work-hour-") as td:
        workdir = Path(td)
        grib_path = workdir / "input.grib2"
        store.get_to_file(uri=source_uri, dst=grib_path)

        scalar_done = 0
        for layer_key in scalar_variables:
            layer = scalar_variables_cfg.get(layer_key) if isinstance(scalar_variables_cfg, Mapping) else None
            if not isinstance(layer, Mapping):
                raise SystemExit(f"Unknown scalar variable in workload.variables: {layer_key}")

            item = WorkItem(cycle=cycle, fhour=fhour, source_uri=source_uri, layer=str(layer_key))
            success_payload = _run_scalar_item(
                ctx=ctx,
                item=item,
                layer=layer,
                store=store,
                grib_path=grib_path,
                workdir=workdir,
                run=run,
            )
            _write_success_marker(ctx=ctx, item=item, store=store, payload=success_payload)
            scalar_done += 1

        vector_done = 0
        for vector_key in vector_variables:
            vector_variable = vector_variables_cfg.get(vector_key)
            if not isinstance(vector_variable, Mapping):
                raise SystemExit(f"Invalid vector_variables entry for key: {vector_key}")

            item = WorkItem(cycle=cycle, fhour=fhour, source_uri=source_uri, layer=str(vector_key))
            success_payload = _run_vector_item(
                ctx=ctx,
                item=item,
                vector_variable=vector_variable,
                store=store,
                grib_path=grib_path,
                workdir=workdir,
                run=run,
            )
            _write_success_marker(ctx=ctx, item=item, store=store, payload=success_payload)
            vector_done += 1

    print(
        f"Done. Published fhour bundle cycle={cycle} fhour={fhour}: "
        f"scalar_variables={scalar_done} vector_variables={vector_done}",
        flush=True,
    )
