"""GFS ETL pipeline.

This package contains the ETL pipeline implementation used to:
- download/cache GRIB inputs (see `nomads.py`)
- generate MBTiles via GDAL (see `gdal_ops.py` + `worker.py`)
- publish manifests/markers for the frontend (see `publish.py`)
"""

from __future__ import annotations

__all__ = [
    "config",
    "contracts",
]

