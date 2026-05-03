"""Prepared source objects handed from model adapters to product execution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

PREPARED_SOURCE_GRIB = "grib"
PREPARED_SOURCE_GRIB_COLLECTION = "grib_collection"


@dataclass(frozen=True)
class PreparedSource:
    kind: str
    uri: str
    grid_id: str
    path: Path | None = None
    grib_paths: dict[str, Path] | None = None

    @classmethod
    def grib(cls, *, uri: str, path: Path, grid_id: str) -> "PreparedSource":
        return cls(kind=PREPARED_SOURCE_GRIB, uri=uri, grid_id=grid_id, path=path)

    @classmethod
    def grib_collection(cls, *, uri: str, grib_paths: dict[str, Path], grid_id: str) -> "PreparedSource":
        return cls(
            kind=PREPARED_SOURCE_GRIB_COLLECTION,
            uri=uri,
            grid_id=grid_id,
            grib_paths=dict(grib_paths),
        )
