"""Shared product execution for forecast binary payloads."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..artifacts.paths import ArtifactPaths, WorkItem
from ..config.schema import (
    PRODUCT_KIND_SCALAR,
    PRODUCT_KIND_VECTOR,
    ExecutionContext,
    ProductSpec,
    ScalarEncodingSpec,
    VectorEncodingSpec,
)
from ..encoding.scalar import encode_scalar_f32_to_payload
from ..encoding.wind import WIND_FORMAT, quantize_f32_to_i8_q0p5
from ..proc import RunFn
from ..sources.grib import (
    extract_float32_band_bytes,
    find_grib_band_by_metadata,
    grid_meta_from_grib,
)
from ..sources.prepared import PREPARED_SOURCE_GRIB, PREPARED_SOURCE_ZERO, PreparedSource
from ..stores.base import UriStore
from .metadata import (
    build_product_marker_metadata,
    component_item_bytes,
)
from .model import EncodedComponent, ExtractedBand, ProductResult


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
    if source.kind == PREPARED_SOURCE_ZERO:
        source_f32_bytes = b"\x00" * (int(grid["nx"]) * int(grid["ny"]) * 4)
        return ExtractedBand(
            component_id=component_id,
            grib_match=grib_match,
            source_f32_bytes=source_f32_bytes,
            source_byte_order="little",
            band_index=0,
            band_metadata={"SOURCE": "zero_placeholder", **grib_match},
            grid=grid,
        )

    if source.kind != PREPARED_SOURCE_GRIB or source.path is None:
        raise SystemExit(f"Unsupported prepared source kind: {source.kind!r}")

    band_idx, band_md = find_grib_band_by_metadata(
        source.path,
        grib_match,
        run=run,
    )
    source_f32_bytes, source_byte_order = extract_float32_band_bytes(
        grib_path=source.path,
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
        grid=grid,
    )


def _encode_scalar_component(*, product: ProductSpec, band: ExtractedBand) -> bytes:
    encoding = product.encoding
    if not isinstance(encoding, ScalarEncodingSpec):
        raise SystemExit(f"Product {product.id} is not configured with scalar encoding")

    return encode_scalar_f32_to_payload(
        source_f32_bytes=band.source_f32_bytes,
        source_byte_order=band.source_byte_order,
        target_dtype=encoding.dtype,
        target_byte_order=encoding.byte_order,
        target_format=encoding.format,
        scale=encoding.scale,
        offset=encoding.offset,
        nodata=encoding.nodata,
        source_transform=product.source_transform,
    )


def _encode_vector_component(*, product: ProductSpec, band: ExtractedBand) -> bytes:
    encoding = product.encoding
    if not isinstance(encoding, VectorEncodingSpec):
        raise SystemExit(f"Product {product.id} is not configured with vector encoding")
    if encoding.format != WIND_FORMAT:
        raise SystemExit(f"Product {product.id} has unsupported vector encoding format: {encoding.format!r}")

    return quantize_f32_to_i8_q0p5(
        band.source_f32_bytes,
        byte_order=band.source_byte_order,
    )


def _encode_product_component(
    *,
    product: ProductSpec,
    expected_component_bytes: int,
    band: ExtractedBand,
) -> EncodedComponent:
    if product.kind == PRODUCT_KIND_SCALAR:
        payload_bytes = _encode_scalar_component(product=product, band=band)
    elif product.kind == PRODUCT_KIND_VECTOR:
        payload_bytes = _encode_vector_component(product=product, band=band)
    else:
        raise SystemExit(f"Product {product.id} has unsupported kind: {product.kind!r}")

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
) -> ProductResult:
    """Extract, encode, pack, and publish one configured product."""

    if source.kind == PREPARED_SOURCE_GRIB:
        if source.path is None:
            raise SystemExit("Prepared GRIB source missing local path")
        grid = grid_meta_from_grib(grib_path=source.path, run=run)
    elif source.kind == PREPARED_SOURCE_ZERO:
        if source.grid is None:
            raise SystemExit("Prepared zero source missing grid metadata")
        grid = dict(source.grid)
    else:
        raise SystemExit(f"Unsupported prepared source kind: {source.kind!r}")

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

    expected_component_bytes = int(grid["nx"]) * int(grid["ny"]) * component_item_bytes(product.encoding.dtype)
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

    metadata = build_product_marker_metadata(
        product=product,
        payload_uri=payload_uri,
        payload=payload,
        encoded_components=encoded_components,
        grid_id=source.grid_id,
        grid=grid,
    )
    return ProductResult(kind=product.kind, metadata=metadata)
