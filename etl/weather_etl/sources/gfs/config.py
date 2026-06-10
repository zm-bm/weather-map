"""GFS NOMADS source config parsing."""

from __future__ import annotations

from typing import Literal

from ...config.pipeline import SourceConfig
from ...config.sources import GFS_NOMADS_SOURCE_TYPE
from ...core.validation import FiniteNumber, FrozenModel, NonEmptyStr, parse_model


class GfsNomadsSourceSettings(FrozenModel):
    """Resolved GFS NOMADS acquisition settings."""

    type: Literal["gfs_nomads"] = GFS_NOMADS_SOURCE_TYPE
    grid_id: NonEmptyStr
    base_url: NonEmptyStr
    vars_levels: dict[NonEmptyStr, NonEmptyStr]
    rate_limit_seconds: FiniteNumber


def parse_gfs_nomads_source(source: SourceConfig) -> GfsNomadsSourceSettings:
    """Parse a generic source config into source-owned GFS NOMADS settings."""

    return parse_model(GfsNomadsSourceSettings, source.raw)
