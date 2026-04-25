"""GFS ETL pipeline.

This package contains the ETL pipeline implementation used to:
- download/cache GRIB inputs (see `nomads.py`)
- extract scalar + vector payload artifacts (see `scalar_product.py`, `vector_product.py`)
- publish manifests/markers for the frontend (see `publish.py`)

Legacy weather-raster/MBTiles code remains in-repo for reference but is not
part of the active runtime pipeline.
"""

from __future__ import annotations

__all__ = [
    "aws",
    "config",
    "contracts",
    "wind_codec",
]
