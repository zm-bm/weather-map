"""Forecast ETL pipeline.

This package contains the ETL pipeline implementation used to:
- acquire/cache model inputs (see `source_adapters/`)
- extract GRIB data with GDAL (see `extract/`)
- encode artifact payloads (see `encoding/`)
- publish manifests/markers for the frontend (see `manifest/`)
"""

from __future__ import annotations
