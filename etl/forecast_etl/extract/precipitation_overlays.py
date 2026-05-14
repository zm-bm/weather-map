"""Precipitation overlay derivation helpers."""

from __future__ import annotations

import math
import struct
from collections.abc import Iterable, Mapping

from ..encoding.numeric import iter_float32_values
from .types import ExtractedBand

PRECIP_TYPE_NONE = 0.0
PRECIP_TYPE_RAIN = 1.0
PRECIP_TYPE_FREEZING_RAIN = 2.0
PRECIP_TYPE_ICE_PELLETS = 3.0
PRECIP_TYPE_SNOW = 4.0
PRECIP_TYPE_MIXED = 5.0

PRECIP_PHASE_RAIN = "rain"
PRECIP_PHASE_SNOW = "snow"
PRECIP_PHASE_WINTRY_MIX = "wintry_mix"
GFS_PRECIP_TYPE_INPUT_IDS = ("rain", "freezing_rain", "ice_pellets", "snow")
GFS_PHASE_RATE_INPUT_IDS = ("total", *GFS_PRECIP_TYPE_INPUT_IDS)
ICON_WW_RAIN = {51, 53, 55, 58, 59, 61, 63, 65, 80, 81, 82, 95, 97}
ICON_WW_FREEZING_RAIN = {56, 57, 66, 67}
ICON_WW_ICE_PELLETS = {79, 87, 88, 89, 90, 96, 99}
ICON_WW_SNOW = {71, 73, 75, 77, 85, 86}
ICON_WW_MIXED = {68, 69, 83, 84}
ICON_WW_THUNDERSTORM = {95, 96, 97, 98, 99}


def precip_type_from_gfs_category_bytes(
    *,
    input_bands: Mapping[str, ExtractedBand],
    product_id: str,
) -> bytes:
    """Return categorical precip-type float32 bytes from GFS category bands."""

    bands = {
        input_id: _required_band(input_bands, input_id=input_id, product_id=product_id)
        for input_id in GFS_PRECIP_TYPE_INPUT_IDS
    }
    _validate_equal_lengths(bands.values(), product_id=product_id)

    out = bytearray(len(bands["rain"].source_f32_bytes))
    iterators = {
        input_id: iter_float32_values(band.source_f32_bytes, byte_order=band.source_byte_order)
        for input_id, band in bands.items()
    }
    category_codes = {
        "rain": PRECIP_TYPE_RAIN,
        "freezing_rain": PRECIP_TYPE_FREEZING_RAIN,
        "ice_pellets": PRECIP_TYPE_ICE_PELLETS,
        "snow": PRECIP_TYPE_SNOW,
    }

    for index, values in enumerate(zip(*iterators.values(), strict=True)):
        active = [
            category_codes[input_id]
            for input_id, value in zip(iterators, values, strict=True)
            if math.isfinite(value) and value >= 0.5
        ]
        if active:
            precip_type = active[0] if len(active) == 1 else PRECIP_TYPE_MIXED
        elif any(math.isfinite(value) for value in values):
            precip_type = PRECIP_TYPE_NONE
        else:
            precip_type = math.nan
        struct.pack_into("<f", out, index * 4, precip_type)

    return bytes(out)


def phase_rate_from_gfs_category_bytes(
    *,
    input_bands: Mapping[str, ExtractedBand],
    phase: str,
    product_id: str,
) -> bytes:
    """Return one GFS precipitation phase rate from total PRATE and category bands."""

    bands = {
        input_id: _required_band(input_bands, input_id=input_id, product_id=product_id)
        for input_id in GFS_PHASE_RATE_INPUT_IDS
    }
    _validate_equal_lengths(bands.values(), product_id=product_id)

    out = bytearray(len(bands["total"].source_f32_bytes))
    total_values = iter_float32_values(bands["total"].source_f32_bytes, byte_order=bands["total"].source_byte_order)
    category_iterators = {
        input_id: iter_float32_values(band.source_f32_bytes, byte_order=band.source_byte_order)
        for input_id, band in bands.items()
        if input_id != "total"
    }

    for index, values in enumerate(zip(total_values, *category_iterators.values(), strict=True)):
        total_rate = values[0]
        category_values = values[1:]
        if not math.isfinite(total_rate) or not any(math.isfinite(value) for value in category_values):
            rate = math.nan
        elif _gfs_categories_match_phase(
            category_ids=tuple(category_iterators),
            category_values=category_values,
            phase=phase,
        ):
            rate = max(total_rate, 0.0)
        else:
            rate = 0.0
        struct.pack_into("<f", out, index * 4, rate)

    return bytes(out)


def phase_rate_from_icon_ww_bytes(
    *,
    total_rate_band: ExtractedBand,
    ww_band: ExtractedBand,
    phase: str,
    product_id: str,
) -> bytes:
    """Return one ICON precipitation phase rate from total rate and weather codes."""

    _validate_equal_lengths((total_rate_band, ww_band), product_id=product_id)

    out = bytearray(len(total_rate_band.source_f32_bytes))
    total_values = iter_float32_values(total_rate_band.source_f32_bytes, byte_order=total_rate_band.source_byte_order)
    ww_values = iter_float32_values(ww_band.source_f32_bytes, byte_order=ww_band.source_byte_order)

    for index, (total_rate, raw_code) in enumerate(zip(total_values, ww_values, strict=True)):
        if not (math.isfinite(total_rate) and math.isfinite(raw_code)):
            rate = math.nan
        elif _icon_ww_precip_phase(raw_code) == phase:
            rate = max(total_rate, 0.0)
        else:
            rate = 0.0
        struct.pack_into("<f", out, index * 4, rate)

    return bytes(out)


def precip_type_from_icon_ww_bytes(*, ww_band: ExtractedBand) -> bytes:
    """Return categorical precip-type float32 bytes from ICON weather codes."""

    out = bytearray(len(ww_band.source_f32_bytes))
    values = iter_float32_values(ww_band.source_f32_bytes, byte_order=ww_band.source_byte_order)
    for index, raw_code in enumerate(values):
        precip_type = _icon_ww_precip_type(raw_code)
        struct.pack_into("<f", out, index * 4, precip_type)
    return bytes(out)


def thunderstorm_mask_from_icon_ww_bytes(*, ww_band: ExtractedBand) -> bytes:
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


def _gfs_categories_match_phase(
    *,
    category_ids: tuple[str, ...],
    category_values: tuple[float, ...],
    phase: str,
) -> bool:
    active = {
        category_id
        for category_id, value in zip(category_ids, category_values, strict=True)
        if math.isfinite(value) and value >= 0.5
    }
    if len(active) > 1:
        return phase == PRECIP_PHASE_WINTRY_MIX
    if active == {"rain"}:
        return phase == PRECIP_PHASE_RAIN
    if active == {"snow"}:
        return phase == PRECIP_PHASE_SNOW
    if active & {"freezing_rain", "ice_pellets"}:
        return phase == PRECIP_PHASE_WINTRY_MIX
    return False


def _icon_ww_precip_type(raw_code: float) -> float:
    if not math.isfinite(raw_code):
        return math.nan
    code = int(round(raw_code))
    if code in ICON_WW_RAIN:
        return PRECIP_TYPE_RAIN
    if code in ICON_WW_FREEZING_RAIN:
        return PRECIP_TYPE_FREEZING_RAIN
    if code in ICON_WW_ICE_PELLETS:
        return PRECIP_TYPE_ICE_PELLETS
    if code in ICON_WW_SNOW:
        return PRECIP_TYPE_SNOW
    if code in ICON_WW_MIXED:
        return PRECIP_TYPE_MIXED
    return PRECIP_TYPE_NONE


def _icon_ww_precip_phase(raw_code: float) -> str | None:
    if not math.isfinite(raw_code):
        return None
    code = int(round(raw_code))
    if code in ICON_WW_RAIN:
        return PRECIP_PHASE_RAIN
    if code in ICON_WW_SNOW:
        return PRECIP_PHASE_SNOW
    if code in ICON_WW_FREEZING_RAIN or code in ICON_WW_ICE_PELLETS or code in ICON_WW_MIXED:
        return PRECIP_PHASE_WINTRY_MIX
    return None


def _required_band(
    input_bands: Mapping[str, ExtractedBand],
    *,
    input_id: str,
    product_id: str,
) -> ExtractedBand:
    try:
        return input_bands[input_id]
    except KeyError:
        raise SystemExit(f"Product {product_id} derivation missing input {input_id!r}") from None


def _validate_equal_lengths(bands: Iterable[ExtractedBand], *, product_id: str) -> None:
    lengths = {len(band.source_f32_bytes) for band in bands}
    if len(lengths) != 1:
        raise SystemExit(f"Product {product_id} derivation input byte lengths differ: {sorted(lengths)!r}")
