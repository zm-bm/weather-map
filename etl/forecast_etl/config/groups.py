"""Product group config parsing."""

from __future__ import annotations

from typing import Any, Mapping

from .primitives import parse_non_empty_string, parse_string_tuple
from .schema import PRODUCT_KIND_SCALAR, ProductGroup, ProductSpec

DEFAULT_PRODUCT_GROUP_ID = "products"
DEFAULT_PRODUCT_GROUP_LABEL = "Products"


def parse_product_groups(
    raw_value: Any,
    *,
    products: Mapping[str, ProductSpec],
    groupable_product_ids: tuple[str, ...],
) -> tuple[ProductGroup, ...]:
    if raw_value is None:
        return _default_scalar_product_groups(groupable_product_ids)
    if not groupable_product_ids:
        raise SystemExit("product_groups cannot be provided without groupable scalar products")
    if not isinstance(raw_value, list) or not raw_value:
        raise SystemExit("product_groups must be a non-empty array when provided")

    groupable_product_set = set(groupable_product_ids)
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
        kind = parse_non_empty_string(raw_group.get("kind"), field_name=f"{field_name}.kind")
        if kind != PRODUCT_KIND_SCALAR:
            raise SystemExit(f"{field_name}.kind must be {PRODUCT_KIND_SCALAR!r}; only scalar product groups are supported")
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
            if product is None or product.kind != PRODUCT_KIND_SCALAR:
                raise SystemExit(f"{field_name}.products references unknown groupable scalar product {product_id!r}")
            if product_id not in groupable_product_set:
                raise SystemExit(f"{field_name}.products references groupable product not in workload.products: {product_id!r}")
            if product_id in seen_products:
                raise SystemExit(f"Product appears in multiple product groups: {product_id!r}")
            seen_products.add(product_id)

        groups.append(
            ProductGroup(
                id=group_id,
                label=label,
                kind=kind,
                default_product=default_product,
                products=group_products,
            )
        )

    missing_products = sorted(groupable_product_set - seen_products)
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
            kind=PRODUCT_KIND_SCALAR,
            default_product=groupable_product_ids[0],
            products=groupable_product_ids,
        ),
    )
