"""Success marker inputs for manifest assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping
from urllib.parse import urlparse

from ..artifacts.markers import ProductMarkerPayload, read_product_success_marker
from ..artifacts.paths import ArtifactPaths
from ..config.schema import ProductSpec
from ..products.metadata import encoding_marker_metadata_for_product
from ..stores.base import UriStore
from ._schema import manifest_encoding, manifest_frame, manifest_grid


@dataclass(frozen=True)
class ProductManifestInputs:
    """Manifest-ready marker-derived inputs for one product."""

    encoding: dict[str, Any]
    grid: dict[str, Any]
    frames: dict[str, dict[str, Any]]


def product_manifest_inputs_from_markers(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    artifact_root_uri: str,
    model_id: str,
    cycle: str,
    fhours: tuple[str, ...],
    product_id: str,
    product: ProductSpec,
) -> ProductManifestInputs:
    """Read product markers and validate them against publish context/config."""

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
        product_marker = marker.product

        _assert_fields_match(
            label="Success marker",
            marker_uri=marker_uri,
            actual={
                "cycle": marker.cycle,
                "fhour": marker.fhour,
                "product_id": marker.product_id,
            },
            expected={
                "cycle": cycle,
                "fhour": fhour,
                "product_id": product_id,
            },
        )
        _assert_marker_metadata_matches_product(
            marker_uri=marker_uri,
            product=product,
            product_marker=product_marker,
            encoding_id=encoding_id,
            encoding_entry=raw_encoding_entry,
        )

        if first_grid_id is None:
            first_grid_id = product_marker.grid_id
            first_grid = product_marker.grid
        elif first_grid_id != product_marker.grid_id:
            raise SystemExit(
                f"Grid id mismatch across forecast hours for product={product_id!r}: "
                f"first={first_grid_id!r} current={product_marker.grid_id!r} marker={marker_uri}"
            )
        elif first_grid != product_marker.grid:
            raise SystemExit(
                f"Grid metadata mismatch across forecast hours for product={product_id!r}: "
                f"grid_id={product_marker.grid_id!r} marker={marker_uri}"
            )

        frames[fhour] = manifest_frame(
            path=_relative_artifact_path(artifact_root_uri=artifact_root_uri, uri=product_marker.payload_uri),
            byte_length=product_marker.byte_length,
            sha256=product_marker.sha256,
        )

    if first_grid_id is None or first_grid is None:
        raise SystemExit(f"No product metadata found for product={product_id!r}")

    return ProductManifestInputs(
        encoding=manifest_encoding(encoding_id=encoding_id, encoding=raw_encoding_entry),
        grid=manifest_grid(grid_id=first_grid_id, grid=first_grid),
        frames=frames,
    )


def _assert_marker_metadata_matches_product(
    *,
    marker_uri: str,
    product: ProductSpec,
    product_marker: ProductMarkerPayload,
    encoding_id: str,
    encoding_entry: Mapping[str, Any],
) -> None:
    """Fail when marker product metadata no longer matches current config."""

    _assert_fields_match(
        label="Product",
        marker_uri=marker_uri,
        actual={
            "encoding_id": product_marker.encoding_id,
            "format": product_marker.format,
            "units": product_marker.units,
            "parameter": product_marker.parameter,
            "level": product_marker.level,
            "valid_min": product_marker.valid_min,
            "valid_max": product_marker.valid_max,
            "components": tuple(product_marker.components),
            "style": product_marker.style,
        },
        expected={
            "encoding_id": encoding_id,
            "format": encoding_entry["format"],
            "units": product.units,
            "parameter": product.parameter,
            "level": product.level,
            "valid_min": product.valid_min,
            "valid_max": product.valid_max,
            "components": product.component_ids,
            "style": {
                "layer_id": product.style.layer_id,
                "palette_id": product.style.palette_id,
            },
        },
    )


def _assert_fields_match(
    *,
    label: str,
    marker_uri: str,
    actual: Mapping[str, object],
    expected: Mapping[str, object],
) -> None:
    """Compare marker fields and raise stable domain mismatch messages."""

    for field, expected_value in expected.items():
        actual_value = actual[field]
        if actual_value != expected_value:
            raise SystemExit(
                f"{label} {field} mismatch in marker {marker_uri}: "
                f"marker={actual_value!r} expected={expected_value!r}"
            )


def _relative_artifact_path(*, artifact_root_uri: str, uri: str) -> str:
    """Return a manifest path for a payload URI under the artifact root."""

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
