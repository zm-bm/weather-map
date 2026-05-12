"""Product component extraction from prepared GRIB sources."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config.resolved import ProductSpec
from ..proc import RunFn
from ..source_adapters.base import PreparedSource
from .grib import extract_float32_band_bytes, find_grib_band_by_metadata


@dataclass(frozen=True)
class ExtractedBand:
    """Float32 source bytes extracted for one configured product component."""

    component_id: str
    source_f32_bytes: bytes
    source_byte_order: str


def extract_product_bands(
    *,
    product: ProductSpec,
    grid: dict[str, Any],
    source: PreparedSource,
    workdir: Path,
    run: RunFn,
) -> list[ExtractedBand]:
    """Extract all configured GRIB components for one product."""

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
    """Find and extract one configured GRIB component as Float32 bytes."""

    grib_path = source.component_grib_path(
        product_id=product.id,
        component_id=component_id,
        grib_match=grib_match,
    )
    band_idx, _ = find_grib_band_by_metadata(
        grib_path,
        _band_match_metadata(grib_match),
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
        source_f32_bytes=source_f32_bytes,
        source_byte_order=source_byte_order,
    )


def _band_match_metadata(grib_match: dict[str, str]) -> dict[str, str]:
    return {key: value for key, value in grib_match.items() if key.startswith("GRIB_")}
