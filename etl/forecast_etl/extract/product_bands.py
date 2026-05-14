"""Dispatch product output-band extraction from prepared GRIB sources."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.resolved import ComponentSpec, ProductSpec
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .derived_product_bands import extract_derived_product_band
from .source_bands import extract_source_band
from .types import ExtractedBand


def extract_product_bands(
    *,
    product: ProductSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
    fhour: str | None = None,
) -> list[ExtractedBand]:
    """Extract all output bands for one product."""

    if product.derivation is not None:
        return [
            extract_derived_product_band(
                product=product,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                fhour=fhour,
            )
        ]

    return [
        extract_source_band(
            product=product,
            band_id=component.id,
            grib_match=_direct_component_grib_match(product=product, component=component),
            grid=grid,
            source=source,
            workdir_path=workdir / f"{product.id}.{component.id}.f32.bin",
            run=run,
        )
        for component in product.components
    ]


def _direct_component_grib_match(*, product: ProductSpec, component: ComponentSpec) -> dict[str, str]:
    if component.grib_match is None:
        raise SystemExit(f"Product {product.id}.{component.id} requires grib_match for direct extraction")
    return dict(component.grib_match)
