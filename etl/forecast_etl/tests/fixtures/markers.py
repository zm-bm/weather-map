from __future__ import annotations

import json
from typing import Any

from forecast_etl.artifacts.markers_schema import build_product_marker_payload
from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.encoding.product_payload import encode_product_payload
from forecast_etl.extract.types import ExtractedBand
from forecast_etl.storage.routing import make_store

from .grids import pack_f32
from .products import product_spec, wind_product_config


def write_json(uri: str, obj: dict) -> None:
    store = make_store()
    store.write_bytes(uri=uri, data=(json.dumps(obj, sort_keys=True) + "\n").encode("utf-8"))


def write_scalar_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    source_values: list[float],
    product_config: dict,
    grid_meta: dict[str, Any],
) -> None:
    component_id = str(product_config["components"][0]["id"])
    write_product_marker(
        store=store,
        ap=ap,
        cycle=cycle,
        fhour=fhour,
        product_id=variable,
        product_config=product_config,
        grid_meta=grid_meta,
        source_values_by_component={component_id: source_values},
    )


def write_vector_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    grid_meta: dict[str, Any],
) -> None:
    cell_count = int(grid_meta["nx"]) * int(grid_meta["ny"])
    write_product_marker(
        store=store,
        ap=ap,
        cycle=cycle,
        fhour=fhour,
        product_id=variable,
        product_config=wind_product_config(),
        grid_meta=grid_meta,
        source_values_by_component={
            "u": [float(i % 128) * 0.5 for i in range(cell_count)],
            "v": [float((i + 7) % 128) * 0.5 for i in range(cell_count)],
        },
    )


def write_product_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    product_id: str,
    product_config: dict,
    grid_meta: dict[str, Any],
    source_values_by_component: dict[str, list[float]],
    grid_id: str = "gfs_0p25_global",
) -> None:
    product = product_spec(product_id, product_config)
    bands = [
        ExtractedBand(
            component_id=component.id,
            source_f32_bytes=pack_f32(source_values_by_component[component.id], byte_order="little"),
            source_byte_order="little",
        )
        for component in product.components
    ]
    payload = encode_product_payload(product=product, grid=grid_meta, bands=bands)
    item = WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, product_id=product_id, source_uri="file:///dev/null")
    artifacts = ArtifactRepository(store=store, paths=ap)
    payload_uri = artifacts.write_field_payload(item=item, dtype=product.encoding.dtype, payload=payload)
    product_marker = build_product_marker_payload(
        product=product,
        payload_uri=payload_uri,
        payload=payload,
        grid_id=grid_id,
        grid=grid_meta,
    )
    artifacts.write_success_marker(
        item=item,
        product=product_marker,
    )
