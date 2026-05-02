"""Forecast ETL pipeline.

This package contains the ETL pipeline implementation used to:
- download/cache GRIB inputs (see `sources/`)
- extract product payload artifacts (see `products/`)
- publish manifests/markers for the frontend (see `manifest/`)
"""

from __future__ import annotations
