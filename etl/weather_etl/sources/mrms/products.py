"""MRMS product identities used by the V1 observed radar dataset."""

from __future__ import annotations

from dataclasses import dataclass

MRMS_PRODUCT_SELECTOR_KEY = "MRMS_PRODUCT"


@dataclass(frozen=True)
class MrmsProduct:
    """One MRMS 2D product routed to one artifact."""

    artifact_id: str
    product: str
    filename_prefix: str
    grib_element: str
    level: str = "00.50"

    @property
    def cache_filename(self) -> str:
        return f"{self.product}.grib2"


MRMS_BASE_REFLECTIVITY = MrmsProduct(
    artifact_id="observed_radar_base_reflectivity",
    product="ReflectivityAtLowestAltitude",
    filename_prefix="MRMS_ReflectivityAtLowestAltitude",
    grib_element="ReflectivityAtLowestAltitude",
)

MRMS_COMPOSITE_REFLECTIVITY = MrmsProduct(
    artifact_id="observed_radar_composite_reflectivity",
    product="MergedReflectivityQCComposite",
    filename_prefix="MRMS_MergedReflectivityQCComposite",
    grib_element="MergedReflectivityQCComposite",
)

MRMS_PRODUCTS = (
    MRMS_BASE_REFLECTIVITY,
    MRMS_COMPOSITE_REFLECTIVITY,
)

MRMS_PRODUCTS_BY_NAME = {product.product: product for product in MRMS_PRODUCTS}
