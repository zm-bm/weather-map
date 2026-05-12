"""Extraction helpers for products derived from prepared source fields."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.resolved import ProductSpec
from ..derivations import DERIVATION_ICON_TOT_PREC_DELTA_RATE, icon_param_from_grib_match, previous_icon_param_key
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .accumulation import accumulation_delta_rate_bytes
from .direct_product_bands import extract_product_band
from .types import ExtractedBand


def extract_derived_product_band(
    *,
    product: ProductSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str | None,
) -> ExtractedBand:
    """Extract one supported derived product component as Float32 bytes."""

    derivation = product.derivation
    if derivation is None:
        raise SystemExit(f"Product {product.id} does not declare a derivation")
    if derivation.type != DERIVATION_ICON_TOT_PREC_DELTA_RATE:
        raise SystemExit(f"Unsupported product derivation for {product.id}: {derivation.type!r}")
    if len(product.components) != 1:
        raise SystemExit(f"Product derivation {derivation.type!r} requires exactly one component for {product.id}")
    if product.temporal is None or product.temporal.source_interval_hours is None:
        raise SystemExit(f"Product derivation {derivation.type!r} requires source_interval_hours for {product.id}")
    if fhour is None:
        raise SystemExit(f"Product derivation {derivation.type!r} requires forecast hour context for {product.id}")

    component = product.components[0]
    current_band = extract_product_band(
        product=product,
        component_id=component.id,
        grib_match=component.grib_match,
        grid=grid,
        source=source,
        workdir_path=workdir / f"{product.id}.{component.id}.current.f32.bin",
        run=run,
    )
    previous_band = _previous_accumulation_band(
        product=product,
        component_id=component.id,
        current_band=current_band,
        current_grib_match=component.grib_match,
        grid=grid,
        source=source,
        workdir=workdir,
        run=run,
        fhour=fhour,
    )
    interval_seconds = float(product.temporal.source_interval_hours) * 3600.0

    return ExtractedBand(
        component_id=component.id,
        source_f32_bytes=accumulation_delta_rate_bytes(
            current_bytes=current_band.source_f32_bytes,
            current_byte_order=current_band.source_byte_order,
            previous_bytes=previous_band.source_f32_bytes,
            previous_byte_order=previous_band.source_byte_order,
            interval_seconds=interval_seconds,
            product_id=product.id,
            component_id=component.id,
        ),
        source_byte_order=current_band.source_byte_order,
    )


def _previous_accumulation_band(
    *,
    product: ProductSpec,
    component_id: str,
    current_band: ExtractedBand,
    current_grib_match: dict[str, str],
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str,
) -> ExtractedBand:
    if len(fhour) != 3 or not fhour.isdigit():
        raise SystemExit(f"Forecast hour must be a 3-digit string for {product.id}: {fhour!r}")
    if int(fhour) <= 1:
        return ExtractedBand(
            component_id=component_id,
            source_f32_bytes=b"\x00" * len(current_band.source_f32_bytes),
            source_byte_order=current_band.source_byte_order,
        )
    if product.derivation is None:
        raise SystemExit(f"Product {product.id} does not declare a derivation")

    previous_grib_match = {
        **current_grib_match,
        "ICON_PARAM": previous_icon_param_key(
            icon_param_from_grib_match(product_id=product.id, grib_match=current_grib_match)
        ),
    }
    return extract_product_band(
        product=product,
        component_id=component_id,
        grib_match=previous_grib_match,
        grid=grid,
        source=source,
        workdir_path=workdir / f"{product.id}.{component_id}.previous.f32.bin",
        run=run,
    )
