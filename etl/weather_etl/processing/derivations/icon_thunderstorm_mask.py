"""ICON thunderstorm-mask derivation."""

from __future__ import annotations

import math
import struct
from pathlib import Path
from typing import Any

from weather_etl.config.derivations import DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW
from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.float32 import iter_float32_values

from ...config.pipeline import ArtifactSpec
from ...sources.prepared_grib import PreparedGribSource
from ..proc import RunFn
from .band_inputs import extract_derivation_input_band, single_derivation_input, single_output_component_id

ICON_WW_THUNDERSTORM = {95, 96, 97, 98, 99}


def extract_icon_thunderstorm_mask(
    *,
    artifact: ArtifactSpec,
    grid: dict[str, Any],
    source: PreparedGribSource,
    workdir: Path,
    run: RunFn,
) -> ExtractedBand:
    output_component_id = single_output_component_id(
        artifact=artifact,
        derivation_type=DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
    )
    input_item = single_derivation_input(
        artifact=artifact,
        derivation_type=DERIVATION_THUNDERSTORM_MASK_FROM_ICON_WW,
        input_id="ww",
    )
    ww_band = extract_derivation_input_band(
        artifact=artifact,
        grid=grid,
        source=source,
        input_item=input_item,
        workdir=workdir,
        run=run,
    )
    return ExtractedBand(
        component_id=output_component_id,
        source_f32_bytes=_icon_thunderstorm_mask_bytes(ww_band=ww_band),
        source_byte_order="little",
    )


def _icon_thunderstorm_mask_bytes(*, ww_band: ExtractedBand) -> bytes:
    """Return thunderstorm mask float32 bytes from ICON weather codes."""

    out = bytearray(len(ww_band.source_f32_bytes))
    values = iter_float32_values(ww_band.source_f32_bytes, byte_order=ww_band.source_byte_order)
    for index, raw_code in enumerate(values):
        if not math.isfinite(raw_code):
            value = math.nan
        else:
            value = 1.0 if int(round(raw_code)) in ICON_WW_THUNDERSTORM else 0.0
        struct.pack_into("<f", out, index * 4, value)
    return bytes(out)
