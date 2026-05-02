"""Prepared source objects handed from model adapters to product execution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

PREPARED_SOURCE_GRIB = "grib"
PREPARED_SOURCE_ZERO = "zero"


@dataclass(frozen=True)
class PreparedSource:
    kind: str
    uri: str
    grid_id: str
    path: Path | None = None
    grid: dict[str, Any] | None = None

    @classmethod
    def grib(cls, *, uri: str, path: Path, grid_id: str) -> "PreparedSource":
        return cls(kind=PREPARED_SOURCE_GRIB, uri=uri, grid_id=grid_id, path=path)

    @classmethod
    def zero(cls, *, uri: str, grid: dict[str, Any], grid_id: str) -> "PreparedSource":
        return cls(kind=PREPARED_SOURCE_ZERO, uri=uri, grid_id=grid_id, grid=dict(grid))
