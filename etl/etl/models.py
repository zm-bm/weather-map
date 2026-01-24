from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Plan:
    cycle: str
    revision: str
    cfg: dict[str, Any]


@dataclass(frozen=True)
class JobContext:
    out_dir: Path
    data_dir: Path
    cycle: str
    fhr: str
    layer: str
    grib_relpath: Path
    min_zoom: int
    max_zoom: int


@dataclass(frozen=True)
class JobRef:
    cycle: str
    fhr: str

