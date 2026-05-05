"""Build frontend manifest sections from product success markers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from ..artifacts.markers import ProductMarkerPayload, ProductSuccessMarker, read_product_success_marker
from ..artifacts.paths import ArtifactPaths
from ..config.groups import DEFAULT_PRODUCT_GROUP_ID, DEFAULT_PRODUCT_GROUP_LABEL
from ..config.schema import ProductGroup, ProductSpec
from ..products.metadata import encoding_marker_metadata_for_product
from ..stores.base import UriStore
from .constants import (
    FORECAST_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from .revision import compute_manifest_revision


def product_groups_for_manifest(
    *,
    product_groups: Iterable[ProductGroup] | None,
    grouped_product_ids: tuple[str, ...],
) -> list[dict[str, Any]]:
    if not grouped_product_ids:
        return []
    if product_groups is None:
        product_groups = (
            ProductGroup(
                id=DEFAULT_PRODUCT_GROUP_ID,
                layer_id="scalar",
                label=DEFAULT_PRODUCT_GROUP_LABEL,
                default_product=grouped_product_ids[0],
                products=grouped_product_ids,
            ),
        )
    return [_product_group_for_manifest(group) for group in product_groups]


def _product_group_for_manifest(group: ProductGroup) -> dict[str, Any]:
    return {
        "id": group.id,
        "layerId": group.layer_id,
        "label": group.label,
        "defaultProductId": group.default_product,
        "productIds": list(group.products),
    }


def build_manifest_products(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    artifact_root_uri: str,
    model_id: str,
    cycle: str,
    fhours: Iterable[str],
    product_ids: Iterable[str],
    products: Mapping[str, ProductSpec],
) -> dict[str, dict[str, Any]]:
    manifest_products: dict[str, dict[str, Any]] = {}
    fhours = tuple(str(fhour) for fhour in fhours)

    for product_id in product_ids:
        product = products.get(product_id)
        if product is None:
            raise SystemExit(f"Missing product config for product {product_id!r}")

        raw_encoding_entry = encoding_marker_metadata_for_product(product)
        encoding_id = str(raw_encoding_entry.pop("encoding_id"))
        first_grid_id: str | None = None
        first_grid: dict[str, Any] | None = None
        frames: dict[str, dict[str, Any]] = {}
        for fhour in fhours:
            marker_uri = paths.success_marker_uri_parts(
                model_id=model_id,
                cycle=cycle,
                fhour=fhour,
                product_id=product_id,
            )
            marker = read_product_success_marker(store=store, uri=marker_uri)
            _assert_marker_identity(
                marker=marker,
                marker_uri=marker_uri,
                cycle=cycle,
                fhour=fhour,
                product_id=product_id,
            )
            product_marker = marker.product

            _assert_marker_metadata_matches_product(
                marker_uri=marker_uri,
                product=product,
                product_marker=product_marker,
                encoding_id=encoding_id,
                encoding_entry=raw_encoding_entry,
            )

            if product_marker.byte_length <= 0:
                raise SystemExit(f"Invalid product.byte_length in marker {marker_uri}: {product_marker.byte_length}")

            grid_id = product_marker.grid_id
            grid = product_marker.grid
            if first_grid_id is None:
                first_grid_id = grid_id
                first_grid = grid
            elif first_grid_id != grid_id:
                raise SystemExit(
                    f"Grid id mismatch across forecast hours for product={product_id!r}: "
                    f"first={first_grid_id!r} current={grid_id!r} marker={marker_uri}"
                )
            elif first_grid != grid:
                raise SystemExit(
                    f"Grid metadata mismatch across forecast hours for product={product_id!r}: "
                    f"grid_id={grid_id!r} marker={marker_uri}"
                )

            frames[str(fhour)] = {
                "path": _relative_artifact_path(artifact_root_uri=artifact_root_uri, uri=product_marker.payload_uri),
                "byteLength": product_marker.byte_length,
                "sha256": product_marker.sha256,
            }

        if first_grid_id is None or first_grid is None:
            raise SystemExit(f"No product metadata found for product={product_id!r}")

        manifest_products[product_id] = {
            "id": product_id,
            "label": product.label or product_id,
            "units": product.units,
            "parameter": product.parameter,
            "level": product.level,
            "components": list(product.component_ids),
            "style": {
                "layerId": product.style.layer_id,
                "paletteId": product.style.palette_id,
            },
            "valueRange": {
                "min": product.valid_min,
                "max": product.valid_max,
            },
            "grid": {
                "id": first_grid_id,
                **_manifest_grid(first_grid),
            },
            "encoding": {
                "id": encoding_id,
                **_manifest_encoding(raw_encoding_entry),
            },
            "frames": frames,
        }

    return manifest_products


def build_cycle_manifest(
    *,
    model_id: str,
    model_label: str,
    cycle: str,
    generated_at: str,
    fhours: Iterable[str],
    product_groups: Iterable[Mapping[str, Any]],
    products: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    run = {
        "cycle": cycle,
        "generatedAt": generated_at,
    }
    manifest_obj = {
        "schema": MANIFEST_SCHEMA,
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "payloadContract": FORECAST_BINARY_CONTRACT,
        "model": {
            "id": model_id,
            "label": model_label,
        },
        "run": run,
        "times": _manifest_times(cycle=cycle, fhours=fhours),
        "groups": list(product_groups),
        "products": products,
    }
    run["revision"] = compute_manifest_revision(manifest_obj)
    return manifest_obj


def _manifest_times(*, cycle: str, fhours: Iterable[str]) -> list[dict[str, object]]:
    cycle_dt = _parse_cycle(cycle)
    times: list[dict[str, object]] = []
    for fhour in fhours:
        lead_hours = int(fhour)
        times.append({
            "id": fhour,
            "leadHours": lead_hours,
            "validAt": (cycle_dt + timedelta(hours=lead_hours)).isoformat().replace("+00:00", "Z"),
        })
    return times


def _parse_cycle(cycle: str) -> datetime:
    return datetime.strptime(cycle, "%Y%m%d%H").replace(tzinfo=timezone.utc)


def _assert_marker_identity(
    *,
    marker: ProductSuccessMarker,
    marker_uri: str,
    cycle: str,
    fhour: str,
    product_id: str,
) -> None:
    for field, marker_value, expected in (
        ("cycle", marker.cycle, cycle),
        ("fhour", marker.fhour, fhour),
        ("product_id", marker.product_id, product_id),
    ):
        if marker_value != expected:
            raise SystemExit(
                f"Success marker {field} mismatch in marker {marker_uri}: "
                f"marker={marker_value!r} expected={expected!r}"
            )


def _assert_marker_metadata_matches_product(
    *,
    marker_uri: str,
    product: ProductSpec,
    product_marker: ProductMarkerPayload,
    encoding_id: str,
    encoding_entry: Mapping[str, Any],
) -> None:
    if product_marker.encoding_id != encoding_id:
        raise SystemExit(
            f"Product encoding_id mismatch in marker {marker_uri}: "
            f"marker={product_marker.encoding_id!r} config={encoding_id!r}"
        )

    if product_marker.format != encoding_entry["format"]:
        raise SystemExit(
            f"Product format mismatch in marker {marker_uri}: "
            f"marker={product_marker.format!r} expected={encoding_entry['format']!r}"
        )

    marker_string_fields = {
        "units": product_marker.units,
        "parameter": product_marker.parameter,
        "level": product_marker.level,
    }
    for field, expected in (
        ("units", product.units),
        ("parameter", product.parameter),
        ("level", product.level),
    ):
        marker_value = marker_string_fields[field]
        if marker_value != expected:
            raise SystemExit(
                f"Product {field} mismatch in marker {marker_uri}: "
                f"marker={marker_value!r} config={expected!r}"
            )

    for field, marker_value, expected in (
        ("valid_min", product_marker.valid_min, product.valid_min),
        ("valid_max", product_marker.valid_max, product.valid_max),
    ):
        if marker_value != expected:
            raise SystemExit(
                f"Product {field} mismatch in marker {marker_uri}: "
                f"marker={marker_value!r} config={expected!r}"
            )

    if tuple(product_marker.components) != product.component_ids:
        raise SystemExit(
            f"Product component metadata mismatch in marker {marker_uri}: "
            f"marker={list(product_marker.components)!r} config={list(product.component_ids)!r}"
        )

    expected_style = {
        "layer_id": product.style.layer_id,
        "palette_id": product.style.palette_id,
    }
    if product_marker.style != expected_style:
        raise SystemExit(
            f"Product style metadata mismatch in marker {marker_uri}: "
            f"marker={product_marker.style!r} config={expected_style!r}"
        )


def _manifest_grid(grid: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "crs": grid["crs"],
        "nx": grid["nx"],
        "ny": grid["ny"],
        "lon0": grid["lon0"],
        "lat0": grid["lat0"],
        "dx": grid["dx"],
        "dy": grid["dy"],
        "origin": grid["origin"],
        "layout": grid["layout"],
        "xWrap": grid["x_wrap"],
        "yMode": grid["y_mode"],
    }


def _manifest_encoding(encoding: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in encoding.items():
        if key == "byte_order":
            out["byteOrder"] = value
        elif key == "decode_formula":
            out["decodeFormula"] = value
        else:
            out[key] = value
    return out


def _relative_artifact_path(*, artifact_root_uri: str, uri: str) -> str:
    root = urlparse(artifact_root_uri)
    target = urlparse(uri)
    if root.scheme != target.scheme or root.netloc != target.netloc:
        raise SystemExit(f"Cannot derive relative artifact path: root={artifact_root_uri!r} uri={uri!r}")

    root_path = root.path.rstrip("/")
    target_path = target.path
    prefix = f"{root_path}/" if root_path else "/"
    if not target_path.startswith(prefix):
        raise SystemExit(f"Payload URI is outside artifact root: root={artifact_root_uri!r} uri={uri!r}")

    rel = target_path[len(prefix):]
    if not rel:
        raise SystemExit(f"Payload URI resolved to empty relative path: {uri!r}")
    return rel
