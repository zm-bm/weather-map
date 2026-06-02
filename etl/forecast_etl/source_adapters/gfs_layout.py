"""GFS GRIB filename and local cache path conventions."""

from __future__ import annotations

from pathlib import Path


def grib_name(*, cycle_hour: str, frame_id: str) -> str:
    """GFS 0.25deg GRIB filename for a cycle hour + forecast hour."""
    return f"gfs.t{cycle_hour}z.pgrb2.0p25.f{frame_id}"


def grib_cache_path(*, etl_dir: Path, dataset_id: str, cycle: str, cycle_hour: str, frame_id: str) -> Path:
    """Local cache location for a GRIB file."""
    return etl_dir / "cache" / "grib" / dataset_id / cycle / grib_name(cycle_hour=cycle_hour, frame_id=frame_id)
