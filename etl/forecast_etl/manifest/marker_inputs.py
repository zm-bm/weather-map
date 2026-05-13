"""Success marker inputs for manifest assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..artifacts.markers_schema import ProductMarkerPayload
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ProductSpec
from ..encoding.codecs import LINEAR_DECODE_FORMULA, is_linear_encoding_format
from .schema import manifest_encoding, manifest_frame, manifest_grid


@dataclass(frozen=True)
class ProductManifestInputs:
    """Manifest-ready marker-derived inputs for one product."""

    encoding: dict[str, Any]
    grid: dict[str, Any]
    frames: dict[str, dict[str, Any]]


def product_manifest_inputs_from_markers(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    fhours: tuple[str, ...],
    product_id: str,
    product: ProductSpec,
) -> ProductManifestInputs:
    """Read product markers and validate them against publish context/config."""

    raw_encoding_entry = _encoding_marker_metadata_for_product(product)
    encoding_id = str(raw_encoding_entry.pop("encoding_id"))

    first_grid_id: str | None = None
    first_grid: dict[str, Any] | None = None
    frames: dict[str, dict[str, Any]] = {}

    for fhour in fhours:
        marker_uri = artifacts.paths.success_marker_uri_parts(
            model_id=model_id,
            cycle=cycle,
            fhour=fhour,
            product_id=product_id,
        )
        marker = artifacts.read_product_success_marker_uri(marker_uri)
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
            path=_relative_artifact_path(artifacts=artifacts, uri=product_marker.payload_uri),
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
            "components": tuple(product_marker.components),
        },
        expected={
            "encoding_id": encoding_id,
            "format": encoding_entry["format"],
            "units": product.units,
            "parameter": product.parameter,
            "level": product.level,
            "components": product.component_ids,
        },
    )


def _encoding_marker_metadata_for_product(product: ProductSpec) -> dict[str, Any]:
    """Build manifest encoding metadata from a resolved product config."""

    encoding = product.encoding
    metadata: dict[str, Any] = {
        "format": encoding.format,
        "dtype": encoding.dtype,
        "byte_order": encoding.byte_order,
        "encoding_id": encoding.id,
    }
    if encoding.nodata is not None:
        metadata["nodata"] = encoding.nodata
    if is_linear_encoding_format(encoding.format):
        metadata["scale"] = encoding.scale
        metadata["offset"] = encoding.offset
        metadata["decode_formula"] = LINEAR_DECODE_FORMULA
    return metadata


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


def _relative_artifact_path(*, artifacts: ArtifactRepository, uri: str) -> str:
    """Return a manifest path for a payload URI under the artifact root."""

    try:
        rel = artifacts.paths.relative_key(uri)
    except ValueError as exc:
        raise SystemExit(str(exc)) from None
    if not rel:
        raise SystemExit(f"Payload URI resolved to empty relative path: {uri!r}")
    return rel
