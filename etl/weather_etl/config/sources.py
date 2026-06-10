"""Static dataset source identifiers used by pipeline config."""

from __future__ import annotations

GFS_NOMADS_SOURCE_TYPE = "gfs_nomads"
ICON_DWD_SOURCE_TYPE = "icon_dwd_icosahedral"

SOURCE_TYPES = {
    GFS_NOMADS_SOURCE_TYPE,
    ICON_DWD_SOURCE_TYPE,
}


def validate_source_type(*, dataset_id: str, source_type: str) -> None:
    if source_type not in SOURCE_TYPES:
        raise SystemExit(f"Unsupported dataset source type for {dataset_id!r}: {source_type!r}")
