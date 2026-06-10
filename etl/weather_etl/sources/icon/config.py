"""ICON DWD source config parsing."""

from __future__ import annotations

from typing import Literal

from pydantic import model_validator

from ...config.pipeline import SourceConfig
from ...config.sources import ICON_DWD_SOURCE_TYPE
from ...core.validation import FiniteNumber, FrozenModel, NonEmptyStr, parse_model


class IconDwdSourceSettings(FrozenModel):
    """Resolved ICON DWD acquisition and regridding settings."""

    type: Literal["icon_dwd_icosahedral"] = ICON_DWD_SOURCE_TYPE
    grid_id: NonEmptyStr
    base_url: NonEmptyStr
    rate_limit_seconds: FiniteNumber

    @model_validator(mode="after")
    def _validate_base_url(self) -> "IconDwdSourceSettings":
        if not self.normalized_base_url:
            raise ValueError("base_url must not be empty after trimming trailing slashes")
        return self

    @property
    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")


def parse_icon_dwd_source(source: SourceConfig) -> IconDwdSourceSettings:
    """Parse a generic source config into source-owned ICON DWD settings."""

    return parse_model(IconDwdSourceSettings, source.raw)
