"""Build frontend manifest sections from product success markers."""

from __future__ import annotations

from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from ..artifacts.json import read_json
from ..artifacts.paths import ArtifactPaths
from ..config.schema import LayerGroup, ProductSpec
from ..products.metadata import encoding_entry_for_product
from ..stores.base import UriStore
from .constants import (
    DEFAULT_LAYER_GROUP_ID,
    DEFAULT_LAYER_GROUP_LABEL,
)


def layer_groups_for_manifest(
    *,
    groups: Iterable[LayerGroup] | None,
    scalar_product_ids: tuple[str, ...],
) -> list[dict[str, Any]]:
    if not scalar_product_ids:
        return []
    if groups is None:
        return [
            {
                "id": DEFAULT_LAYER_GROUP_ID,
                "label": DEFAULT_LAYER_GROUP_LABEL,
                "default_variable": scalar_product_ids[0],
                "variables": list(scalar_product_ids),
            }
        ]

    scalar_product_set = set(scalar_product_ids)
    seen_product_ids: set[str] = set()
    out: list[dict[str, Any]] = []
    for group in groups:
        group_obj = group.to_manifest_dict()
        for product_id in group.products:
            if product_id not in scalar_product_set:
                raise SystemExit(f"layer_groups references unknown scalar product {product_id!r}")
            if product_id in seen_product_ids:
                raise SystemExit(f"Scalar product appears in multiple layer groups: {product_id!r}")
            seen_product_ids.add(product_id)
        out.append(group_obj)

    missing_product_ids = sorted(scalar_product_set - seen_product_ids)
    if missing_product_ids:
        raise SystemExit(f"layer_groups missing scalar products: {missing_product_ids!r}")
    return out


def build_manifest_sections(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    artifact_root_uri: str,
    model_id: str,
    cycle: str,
    fhours: Iterable[str],
    product_ids: Iterable[str],
    products: Mapping[str, ProductSpec],
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, dict[str, Any]]],
]:
    grids: dict[str, dict[str, Any]] = {}
    encodings: dict[str, dict[str, Any]] = {}
    variable_meta: dict[str, dict[str, Any]] = {}
    frames: dict[str, dict[str, dict[str, Any]]] = {str(fhour): {} for fhour in fhours}

    for product_id in product_ids:
        product = products.get(product_id)
        if product is None:
            raise SystemExit(f"Missing product config for product {product_id!r}")

        encoding_id, encoding_entry = encoding_entry_for_product(product)
        previous_encoding = encodings.get(encoding_id)
        if previous_encoding is None:
            encodings[encoding_id] = encoding_entry
        elif previous_encoding != encoding_entry:
            raise SystemExit(f"Conflicting encoding definitions for encoding_id={encoding_id!r}")

        first_grid_id: str | None = None
        for fhour in fhours:
            marker_uri = paths.success_marker_uri_parts(
                model_id=model_id,
                cycle=cycle,
                fhour=fhour,
                layer=product_id,
            )
            marker = read_json(store=store, uri=marker_uri)
            product_marker = marker.get("product")
            if not isinstance(product_marker, Mapping):
                raise SystemExit(f"Success marker missing product payload metadata: {marker_uri}")

            marker_kind = _as_str(marker.get("kind"), field=f"{marker_uri}.kind")
            if marker_kind != product.kind:
                raise SystemExit(
                    f"Product kind mismatch in marker {marker_uri}: "
                    f"marker={marker_kind!r} config={product.kind!r}"
                )
            _assert_marker_metadata_matches_product(
                marker_uri=marker_uri,
                product=product,
                product_marker=product_marker,
                encoding_id=encoding_id,
                encoding_entry=encoding_entry,
            )

            payload_uri = _as_str(product_marker.get("payload_uri"), field=f"{marker_uri}.product.payload_uri")
            byte_length = _as_int(product_marker.get("byte_length"), field=f"{marker_uri}.product.byte_length")
            sha256 = _as_str(product_marker.get("sha256"), field=f"{marker_uri}.product.sha256")
            if byte_length <= 0:
                raise SystemExit(f"Invalid product.byte_length in marker {marker_uri}: {byte_length}")

            grid_id = _as_str(product_marker.get("grid_id"), field=f"{marker_uri}.product.grid_id")
            grid = _normalize_grid(product_marker.get("grid"))
            _register_grid(grids=grids, grid_id=grid_id, grid=grid, context=marker_uri)
            if first_grid_id is None:
                first_grid_id = grid_id
            elif first_grid_id != grid_id:
                raise SystemExit(
                    f"Grid id mismatch across forecast hours for product={product_id!r}: "
                    f"first={first_grid_id!r} current={grid_id!r} marker={marker_uri}"
                )

            frames[str(fhour)][product_id] = {
                "path": _relative_artifact_path(artifact_root_uri=artifact_root_uri, uri=payload_uri),
                "byte_length": byte_length,
                "sha256": sha256,
            }

        if first_grid_id is None:
            raise SystemExit(f"No product metadata found for product={product_id!r}")

        variable_meta[product_id] = {
            "kind": product.kind,
            "units": product.units,
            "parameter": product.parameter,
            "level": product.level,
            "valid_min": product.valid_min,
            "valid_max": product.valid_max,
            "grid_id": first_grid_id,
            "encoding_id": encoding_id,
        }

    return grids, encodings, variable_meta, frames


def _assert_marker_metadata_matches_product(
    *,
    marker_uri: str,
    product: ProductSpec,
    product_marker: Mapping[str, Any],
    encoding_id: str,
    encoding_entry: Mapping[str, Any],
) -> None:
    marker_kind = _as_str(product_marker.get("kind"), field=f"{marker_uri}.product.kind") \
        if product_marker.get("kind") is not None else product.kind
    if marker_kind != product.kind:
        raise SystemExit(
            f"Product kind mismatch in marker {marker_uri}: marker={marker_kind!r} config={product.kind!r}"
        )

    marker_encoding_id = _as_str(product_marker.get("encoding_id"), field=f"{marker_uri}.product.encoding_id")
    if marker_encoding_id != encoding_id:
        raise SystemExit(
            f"Product encoding_id mismatch in marker {marker_uri}: "
            f"marker={marker_encoding_id!r} config={encoding_id!r}"
        )

    marker_format = _as_str(product_marker.get("format"), field=f"{marker_uri}.product.format")
    if marker_format != encoding_entry["format"]:
        raise SystemExit(
            f"Product format mismatch in marker {marker_uri}: "
            f"marker={marker_format!r} expected={encoding_entry['format']!r}"
        )

    for field, expected in (
        ("units", product.units),
        ("parameter", product.parameter),
        ("level", product.level),
    ):
        marker_value = _as_str(product_marker.get(field), field=f"{marker_uri}.product.{field}")
        if marker_value != expected:
            raise SystemExit(
                f"Product {field} mismatch in marker {marker_uri}: "
                f"marker={marker_value!r} config={expected!r}"
            )

    for field, expected in (("valid_min", product.valid_min), ("valid_max", product.valid_max)):
        marker_value = _as_float(product_marker.get(field), field=f"{marker_uri}.product.{field}")
        if marker_value != expected:
            raise SystemExit(
                f"Product {field} mismatch in marker {marker_uri}: "
                f"marker={marker_value!r} config={expected!r}"
            )

    if "components" in encoding_entry:
        marker_component_metadata = {
            "components": _as_str_list(product_marker.get("components"), field=f"{marker_uri}.product.components"),
            "component_count": _as_int(product_marker.get("component_count"), field=f"{marker_uri}.product.component_count"),
            "component_order": _as_str(product_marker.get("component_order"), field=f"{marker_uri}.product.component_order"),
        }
        expected_component_metadata = {
            "components": encoding_entry["components"],
            "component_count": encoding_entry["component_count"],
            "component_order": encoding_entry["component_order"],
        }
        if marker_component_metadata != expected_component_metadata:
            raise SystemExit(
                f"Product component metadata mismatch in marker {marker_uri}: "
                f"marker={marker_component_metadata!r} config={expected_component_metadata!r}"
            )


def _normalize_grid(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"grid must be an object, got: {raw!r}")

    return {
        "crs": _as_str(raw.get("crs"), field="grid.crs"),
        "nx": _as_int(raw.get("nx"), field="grid.nx"),
        "ny": _as_int(raw.get("ny"), field="grid.ny"),
        "lon0": _as_float(raw.get("lon0"), field="grid.lon0"),
        "lat0": _as_float(raw.get("lat0"), field="grid.lat0"),
        "dx": _as_float(raw.get("dx"), field="grid.dx"),
        "dy": _as_float(raw.get("dy"), field="grid.dy"),
        "origin": _as_str(raw.get("origin"), field="grid.origin"),
        "layout": _as_str(raw.get("layout"), field="grid.layout"),
        "x_wrap": _as_str(raw.get("x_wrap"), field="grid.x_wrap"),
        "y_mode": _as_str(raw.get("y_mode"), field="grid.y_mode"),
    }


def _register_grid(
    *,
    grids: dict[str, dict[str, Any]],
    grid_id: str,
    grid: dict[str, Any],
    context: str,
) -> None:
    previous = grids.get(grid_id)
    if previous is None:
        grids[grid_id] = grid
        return
    if previous != grid:
        raise SystemExit(f"Grid mismatch for grid_id={grid_id!r} while processing {context}")


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


def _as_str(raw: Any, *, field: str) -> str:
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    raise SystemExit(f"Invalid or missing string field {field!r}: {raw!r}")


def _as_int(raw: Any, *, field: str) -> int:
    if isinstance(raw, int):
        return int(raw)
    raise SystemExit(f"Invalid or missing integer field {field!r}: {raw!r}")


def _as_float(raw: Any, *, field: str) -> float:
    if isinstance(raw, (int, float)):
        return float(raw)
    raise SystemExit(f"Invalid or missing numeric field {field!r}: {raw!r}")


def _as_str_list(raw: Any, *, field: str) -> list[str]:
    if not isinstance(raw, list) or not raw:
        raise SystemExit(f"Invalid or missing string list field {field!r}: {raw!r}")
    return [_as_str(value, field=f"{field}[{idx}]") for idx, value in enumerate(raw)]
