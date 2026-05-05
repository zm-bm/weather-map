"""Pipeline config loading and parsing."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ..stores import make_store
from ._input import ModelConfigInput, PipelineConfigInput
from ._types import parse_config_model
from .groups import parse_product_groups
from .schema import ModelConfig, PipelineConfig, ProductCatalogSpec
from .validate import (
    parse_model_product_spec,
    parse_model_source_config,
    parse_product_catalog_spec,
    parse_workload_config,
    resolve_product_spec,
    validate_model_products_for_source,
    validate_workload_products,
)


def parse_pipeline_config(obj: Mapping[str, Any]) -> PipelineConfig:
    raw = parse_config_model(PipelineConfigInput, obj)
    product_catalog = {
        product_id: parse_product_catalog_spec(product_id=product_id, raw=product_cfg)
        for product_id, product_cfg in raw.product_catalog.items()
    }

    return PipelineConfig(
        product_catalog=product_catalog,
        models={
            model_id: _parse_model_config(
                model_id=model_id,
                raw=model_cfg,
                product_catalog=product_catalog,
            )
            for model_id, model_cfg in raw.models.items()
        },
    )


def _parse_model_config(
    *,
    model_id: str,
    raw: ModelConfigInput,
    product_catalog: Mapping[str, ProductCatalogSpec],
) -> ModelConfig:
    source = parse_model_source_config(raw.source)
    workload = parse_workload_config(raw.workload)
    validate_workload_products(product_ids=workload.products, products=product_catalog)

    model_products = {}
    resolved_products = {}
    for product_id in workload.products:
        catalog_product = product_catalog[product_id]
        raw_model_product = raw.products.get(product_id)
        if raw_model_product is None:
            raise SystemExit(f"models.{model_id}.products missing product {product_id!r}")
        model_product = parse_model_product_spec(
            product_id=product_id,
            raw=raw_model_product,
            catalog_product=catalog_product,
        )
        model_products[product_id] = model_product
        resolved_products[product_id] = resolve_product_spec(
            catalog_product=catalog_product,
            model_product=model_product,
        )

    unknown_model_products = sorted(set(raw.products) - set(workload.products))
    if unknown_model_products:
        raise SystemExit(f"models.{model_id}.products contains products not in workload: {unknown_model_products!r}")
    validate_model_products_for_source(
        model_id=model_id,
        source=source,
        model_products=model_products,
    )

    grouped_product_ids = tuple(
        product_id
        for product_id in workload.products
        if resolved_products[product_id].style.layer_id == "scalar"
    )
    product_groups = parse_product_groups(
        raw.product_groups,
        products=resolved_products,
        grouped_product_ids=grouped_product_ids,
    )

    return ModelConfig(
        id=model_id,
        label=raw.label,
        source=source,
        workload=workload,
        model_products=model_products,
        products=resolved_products,
        product_groups=product_groups,
    )


def load_pipeline_config(pipeline_config_uri: str) -> PipelineConfig:
    store = make_store()
    raw = store.read_bytes(uri=pipeline_config_uri)
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise SystemExit(f"Failed to parse pipeline config {pipeline_config_uri}: {exc}") from exc

    return parse_pipeline_config(obj)
