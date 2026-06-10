"""GFS GRIB filename and local cache path conventions."""

from __future__ import annotations

from pathlib import Path

from ...core.cycles import parse_cycle


def grib_name(*, cycle_hour: str, frame_id: str) -> str:
    """GFS 0.25deg GRIB filename for a cycle hour and lead-hour frame."""
    return f"gfs.t{cycle_hour}z.pgrb2.0p25.f{frame_id}"


def gfs_s3_grib_key(*, cycle: str, frame_id: str) -> str:
    """NOAA GFS S3 object key for one 0.25deg GRIB file."""

    cycle_date, cycle_hour = parse_cycle(cycle)
    return f"gfs.{cycle_date}/{cycle_hour}/atmos/{grib_name(cycle_hour=cycle_hour, frame_id=frame_id)}"


def gfs_s3_grib_uri(*, source_bucket: str, cycle: str, frame_id: str) -> str:
    """NOAA GFS S3 URI for one 0.25deg GRIB file."""

    return f"s3://{source_bucket.strip('/')}/{gfs_s3_grib_key(cycle=cycle, frame_id=frame_id)}"


def grib_cache_path(*, etl_dir: Path, dataset_id: str, cycle: str, cycle_hour: str, frame_id: str) -> Path:
    """Local cache location for a GRIB file."""
    return etl_dir / "cache" / "grib" / dataset_id / cycle / grib_name(cycle_hour=cycle_hour, frame_id=frame_id)
