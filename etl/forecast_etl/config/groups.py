"""Product group config parsing."""

from __future__ import annotations

from typing import Any, Mapping

from ._input import ProductGroupsInput
from ._types import parse_config_model
from .schema import ProductGroup, ProductSpec

DEFAULT_PRODUCT_GROUP_ID = "products"
DEFAULT_PRODUCT_GROUP_LABEL = "Products"


def parse_product_groups(
    raw_value: Any,
    *,
    products: Mapping[str, ProductSpec],
    grouped_product_ids: tuple[str, ...],
) -> tuple[ProductGroup, ...]:
    """Parse product groups and verify exact coverage of groupable products."""

    group_inputs = parse_config_model(ProductGroupsInput, {"groups": raw_value}).groups
    if not grouped_product_ids:
        raise SystemExit("product_groups cannot be provided without groupable products")

    grouped_product_set = set(grouped_product_ids)
    seen_products: set[str] = set()
    groups: list[ProductGroup] = []

    for group_index, group in enumerate(group_inputs):
        field_name = f"product_groups[{group_index}]"
        for product_id in group.products:
            product = products.get(product_id)
            if product is None:
                raise SystemExit(f"{field_name}.products references unknown groupable product {product_id!r}")
            if product.style.layer_id != group.layer_id:
                raise SystemExit(
                    f"{field_name}.products references product {product_id!r} with layer_id "
                    f"{product.style.layer_id!r}, expected {group.layer_id!r}"
                )
            if product_id not in grouped_product_set:
                raise SystemExit(f"{field_name}.products references groupable product not in workload.products: {product_id!r}")
            if product_id in seen_products:
                raise SystemExit(f"Product appears in multiple product groups: {product_id!r}")
            seen_products.add(product_id)

        groups.append(
            ProductGroup(
                id=group.id,
                label=group.label,
                layer_id=group.layer_id,
                default_product=group.default_product,
                products=group.products,
            )
        )

    missing_products = sorted(grouped_product_set - seen_products)
    if missing_products:
        raise SystemExit(f"product_groups missing groupable products: {missing_products!r}")

    return tuple(groups)
