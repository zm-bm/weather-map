"""Product group config parsing."""

from __future__ import annotations

from typing import Any, Mapping

from .primitives import parse_non_empty_string, parse_string_tuple
from .schema import ProductGroup, ProductSpec

DEFAULT_PRODUCT_GROUP_ID = "products"
DEFAULT_PRODUCT_GROUP_LABEL = "Products"
DEFAULT_PRODUCT_GROUP_LAYER_ID = "scalar"


def parse_product_groups(
    raw_value: Any,
    *,
    products: Mapping[str, ProductSpec],
    grouped_product_ids: tuple[str, ...],
) -> tuple[ProductGroup, ...]:
    if raw_value is None:
        return _default_scalar_product_groups(grouped_product_ids)
    if not grouped_product_ids:
        raise SystemExit("product_groups cannot be provided without groupable products")
    if not isinstance(raw_value, list) or not raw_value:
        raise SystemExit("product_groups must be a non-empty array when provided")

    grouped_product_set = set(grouped_product_ids)
    seen_group_ids: set[str] = set()
    seen_products: set[str] = set()
    groups: list[ProductGroup] = []

    for group_index, raw_group in enumerate(raw_value):
        field_name = f"product_groups[{group_index}]"
        if not isinstance(raw_group, Mapping):
            raise SystemExit(f"{field_name} must be an object")

        group_id = parse_non_empty_string(raw_group.get("id"), field_name=f"{field_name}.id")
        if group_id in seen_group_ids:
            raise SystemExit(f"Duplicate product group id: {group_id!r}")
        seen_group_ids.add(group_id)

        label = parse_non_empty_string(raw_group.get("label"), field_name=f"{field_name}.label")
        layer_id = parse_non_empty_string(raw_group.get("layer_id"), field_name=f"{field_name}.layer_id")
        default_product = parse_non_empty_string(
            raw_group.get("default_product"),
            field_name=f"{field_name}.default_product",
        )
        group_products = parse_string_tuple(raw_group.get("products"), field_name=f"{field_name}.products")

        if default_product not in group_products:
            raise SystemExit(
                f"{field_name}.default_product {default_product!r} must be included in {field_name}.products"
            )

        for product_id in group_products:
            product = products.get(product_id)
            if product is None:
                raise SystemExit(f"{field_name}.products references unknown groupable product {product_id!r}")
            if product.style.layer_id != layer_id:
                raise SystemExit(
                    f"{field_name}.products references product {product_id!r} with layer_id "
                    f"{product.style.layer_id!r}, expected {layer_id!r}"
                )
            if product_id not in grouped_product_set:
                raise SystemExit(f"{field_name}.products references groupable product not in workload.products: {product_id!r}")
            if product_id in seen_products:
                raise SystemExit(f"Product appears in multiple product groups: {product_id!r}")
            seen_products.add(product_id)

        groups.append(
            ProductGroup(
                id=group_id,
                label=label,
                layer_id=layer_id,
                default_product=default_product,
                products=group_products,
            )
        )

    missing_products = sorted(grouped_product_set - seen_products)
    if missing_products:
        raise SystemExit(f"product_groups missing groupable products: {missing_products!r}")

    return tuple(groups)


def _default_scalar_product_groups(groupable_product_ids: tuple[str, ...]) -> tuple[ProductGroup, ...]:
    if not groupable_product_ids:
        return ()
    return (
        ProductGroup(
            id=DEFAULT_PRODUCT_GROUP_ID,
            label=DEFAULT_PRODUCT_GROUP_LABEL,
            layer_id=DEFAULT_PRODUCT_GROUP_LAYER_ID,
            default_product=groupable_product_ids[0],
            products=groupable_product_ids,
        ),
    )
