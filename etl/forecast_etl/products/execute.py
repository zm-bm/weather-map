"""Shared product execution for forecast binary payloads."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..artifacts.paths import ArtifactPaths, WorkItem
from ..config.schema import (
    PRODUCT_KIND_SCALAR,
    ExecutionContext,
    ProductSpec,
)
from ..encoding.codecs import encode_component_payload
from ..encoding.numeric import int_item_bytes
from ..proc import RunFn
from ..sources.grib import (
    extract_float32_band_bytes,
    find_grib_band_by_metadata,
    grid_meta_from_grib,
)
from ..sources.prepared import PreparedSource
from ..stores.base import UriStore
from .metadata import build_product_marker_metadata
from .model import EncodedComponent, ExtractedBand
from .transforms import source_value_transform


def _band_match_metadata(grib_match: dict[str, str]) -> dict[str, str]:
    return {key: value for key, value in grib_match.items() if key.startswith("GRIB_")}


def extract_product_band(
    *,
    product: ProductSpec,
    component_id: str,
    grib_match: dict[str, str],
    grid: dict[str, Any],
    source: PreparedSource,
    workdir_path: Path,
    run: RunFn,
) -> ExtractedBand:
    grib_path = source.component_grib_path(
        product_id=product.id,
        component_id=component_id,
        grib_match=grib_match,
    )
    band_match = _band_match_metadata(grib_match)
    band_idx, band_md = find_grib_band_by_metadata(
        grib_path,
        band_match,
        run=run,
    )
    source_f32_bytes, source_byte_order = extract_float32_band_bytes(
        grib_path=grib_path,
        band_idx=band_idx,
        workdir_path=workdir_path,
        run=run,
    )

    expected_source_bytes = int(grid["nx"]) * int(grid["ny"]) * 4
    if len(source_f32_bytes) != expected_source_bytes:
        raise SystemExit(
            f"Unexpected product component source byte length for {product.id}.{component_id}: "
            f"got={len(source_f32_bytes)} expected={expected_source_bytes}"
        )

    return ExtractedBand(
        component_id=component_id,
        grib_match=grib_match,
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
        band_index=band_idx,
        band_metadata={str(k): str(v) for k, v in band_md.items()},
    )


def _encode_product_component(
    *,
    product: ProductSpec,
    expected_component_bytes: int,
    band: ExtractedBand,
) -> EncodedComponent:
    encoding = product.encoding
    transform = source_value_transform(product.source_transform)
    payload_bytes = encode_component_payload(
        source_f32_bytes=band.source_f32_bytes,
        source_byte_order=band.source_byte_order,
        target_dtype=encoding.dtype,
        target_byte_order=encoding.byte_order,
        target_format=encoding.format,
        scale=encoding.scale,
        offset=encoding.offset,
        nodata=encoding.nodata,
        value_transform=transform,
    )

    if len(payload_bytes) != expected_component_bytes:
        raise SystemExit(
            f"Unexpected encoded component byte length for {product.id}.{band.component_id}: "
            f"got={len(payload_bytes)} expected={expected_component_bytes}"
        )

    return EncodedComponent(
        component_id=band.component_id,
        payload_bytes=payload_bytes,
        source_byte_order=band.source_byte_order,
        band_index=band.band_index,
        band_metadata=band.band_metadata,
        grib_match=band.grib_match,
    )


def run_product_item_in_workdir(
    *,
    workdir: Path,
    ctx: ExecutionContext,
    item: WorkItem,
    product: ProductSpec,
    store: UriStore,
    source: PreparedSource,
    run: RunFn,
) -> dict[str, Any]:
    """Extract, encode, pack, and publish one configured product."""

    grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=run)
    extracted_components = [
        extract_product_band(
            product=product,
            component_id=component.id,
            grib_match=component.grib_match,
            grid=grid,
            source=source,
            workdir_path=workdir / f"{product.id}.{component.id}.f32.bin",
            run=run,
        )
        for component in product.components
    ]

    expected_component_bytes = int(grid["nx"]) * int(grid["ny"]) * _component_item_bytes(product.encoding.dtype)
    encoded_components = [
        _encode_product_component(
            product=product,
            expected_component_bytes=expected_component_bytes,
            band=band,
        )
        for band in extracted_components
    ]

    payload = b"".join(component.payload_bytes for component in encoded_components)
    paths = ArtifactPaths(ctx.artifact_root_uri)
    if product.kind == PRODUCT_KIND_SCALAR:
        payload_uri = paths.output_scalar_payload_uri(item, dtype=product.encoding.dtype)
    else:
        payload_uri = paths.output_vector_payload_uri(item)
    store.write_bytes(uri=payload_uri, data=payload)

    return build_product_marker_metadata(
        product=product,
        payload_uri=payload_uri,
        payload=payload,
        encoded_components=encoded_components,
        grid_id=source.grid_id,
        grid=grid,
    )


def _component_item_bytes(dtype: str) -> int:
    try:
        return int_item_bytes(dtype)
    except ValueError as exc:
        raise SystemExit(f"Unsupported product dtype: {dtype!r}") from exc
