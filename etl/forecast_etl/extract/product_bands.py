"""Dispatch product component extraction from prepared GRIB sources."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.resolved import ProductSpec
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .derived_product_bands import extract_derived_product_band
from .direct_product_bands import extract_product_band
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
    """Extract all configured GRIB components for one product."""

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
