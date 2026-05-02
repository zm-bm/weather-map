"""Pipeline config loading and parsing."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ..stores import make_store
from .schema import (
    PRODUCT_KIND_SCALAR,
    ModelConfig,
    PipelineConfig,
    ProductCatalogSpec,
)
from .validate import (
    parse_model_source_config,
    parse_product_binding_spec,
    parse_product_catalog_spec,
    parse_scalar_variable_groups,
    parse_workload_config,
    resolve_product_spec,
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

    bindings_obj = raw.get("product_bindings")
    if not isinstance(bindings_obj, Mapping):
        raise SystemExit(f"models.{model_id} missing valid 'product_bindings' object")

    product_bindings = {}
    resolved_products = {}
    for product_id in workload.products:
        catalog_product = product_catalog[product_id]
        raw_binding = bindings_obj.get(product_id)
        if raw_binding is None:
            raise SystemExit(f"models.{model_id}.product_bindings missing product {product_id!r}")
        binding = parse_product_binding_spec(
            product_id=product_id,
            raw=raw_binding,
            catalog_product=catalog_product,
        )
        product_bindings[product_id] = binding
        resolved_products[product_id] = resolve_product_spec(
            catalog_product=catalog_product,
            binding=binding,
        )

    unknown_bindings = sorted(set(str(key) for key in bindings_obj) - set(workload.products))
    if unknown_bindings:
        raise SystemExit(f"models.{model_id}.product_bindings contains products not in workload: {unknown_bindings!r}")

    scalar_product_ids = tuple(
        product_id
        for product_id in workload.products
        if resolved_products[product_id].kind == PRODUCT_KIND_SCALAR
    )
    scalar_variable_groups = parse_scalar_variable_groups(
        raw.get("scalar_variable_groups"),
        products=resolved_products,
        scalar_product_ids=scalar_product_ids,
    )

    return ModelConfig(
        id=model_id,
        label=label,
        source=source,
        workload=workload,
        product_bindings=product_bindings,
        products=resolved_products,
        scalar_variable_groups=scalar_variable_groups,
    )


def load_pipeline_config(pipeline_config_uri: str) -> PipelineConfig:
    store = make_store()
    raw = store.read_bytes(uri=pipeline_config_uri)
    try:
        obj = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise SystemExit(f"Failed to parse pipeline config {pipeline_config_uri}: {exc}") from exc

    return parse_pipeline_config(obj)
