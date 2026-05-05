"""Pipeline config loading and parsing."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ..stores import make_store
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
    if not isinstance(obj, Mapping):
        raise SystemExit("pipeline_config must be a JSON object")

    version = obj.get("version")
    if not isinstance(version, int) or version != 2:
        raise SystemExit("pipeline_config version must be 2")
    for old_field in ("workload", "nomads", "products", "scalar_variables", "vector_variables"):
        if old_field in obj:
            raise SystemExit(
                "single-model pipeline config fields are no longer supported; "
                "use product_catalog and models"
            )

    catalog_obj = obj.get("product_catalog")
    if not isinstance(catalog_obj, Mapping):
        raise SystemExit("pipeline_config missing valid 'product_catalog' object")
    product_catalog = {
        str(product_id): parse_product_catalog_spec(product_id=str(product_id), raw=product_cfg)
        for product_id, product_cfg in catalog_obj.items()
    }

    models_obj = obj.get("models")
    if not isinstance(models_obj, Mapping) or not models_obj:
        raise SystemExit("pipeline_config missing valid non-empty 'models' object")

    return PipelineConfig(
        product_catalog=product_catalog,
        models={
            str(model_id): _parse_model_config(
                model_id=str(model_id),
                raw=model_cfg,
                product_catalog=product_catalog,
            )
            for model_id, model_cfg in models_obj.items()
        },
    )


def _parse_model_config(
    *,
    model_id: str,
    raw: Any,
    product_catalog: Mapping[str, ProductCatalogSpec],
) -> ModelConfig:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"models.{model_id} must be an object")

    label_raw = raw.get("label")
    label = label_raw.strip() if isinstance(label_raw, str) and label_raw.strip() else model_id.upper()
    source = parse_model_source_config(raw.get("source"))
    workload = parse_workload_config(raw.get("workload"))
    validate_workload_products(product_ids=workload.products, products=product_catalog)

    if "product_bindings" in raw:
        raise SystemExit(f"models.{model_id}.product_bindings is no longer supported; use models.{model_id}.products")
    if "scalar_variable_groups" in raw:
        raise SystemExit(f"models.{model_id}.scalar_variable_groups is no longer supported; use models.{model_id}.product_groups")
    if "layer_groups" in raw:
        raise SystemExit(f"models.{model_id}.layer_groups is no longer supported; use models.{model_id}.product_groups")

    model_products_obj = raw.get("products")
    if not isinstance(model_products_obj, Mapping):
        raise SystemExit(f"models.{model_id} missing valid 'products' object")

    model_products = {}
    resolved_products = {}
    for product_id in workload.products:
        catalog_product = product_catalog[product_id]
        raw_model_product = model_products_obj.get(product_id)
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

    unknown_model_products = sorted(set(str(key) for key in model_products_obj) - set(workload.products))
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
        raw.get("product_groups"),
        products=resolved_products,
        grouped_product_ids=grouped_product_ids,
    )

    return ModelConfig(
        id=model_id,
        label=label,
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
