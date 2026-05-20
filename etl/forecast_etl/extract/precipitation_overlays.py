"""Precipitation overlay derivation helpers."""

from __future__ import annotations

import math
import struct
from collections.abc import Callable, Iterable, Mapping

from ..encoding.numeric import iter_float32_values
from .types import ExtractedBand

GFS_PRECIP_TYPE_OVERLAY_INPUT_IDS = (
    "precip_rate",
    "frozen_percent",
    "rain",
    "freezing_rain",
    "ice_pellets",
    "snow",
)
ICON_PRECIP_TYPE_OVERLAY_INPUT_IDS = ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
SNOW_FRACTION_COMPONENT_ID = "snow_frac"
MIX_FRACTION_COMPONENT_ID = "mix_frac"
PRECIP_TYPE_OVERLAY_COMPONENT_IDS = (SNOW_FRACTION_COMPONENT_ID, MIX_FRACTION_COMPONENT_ID)
PRECIP_TYPE_OVERLAY_MIN_INTENSITY_MM_HR = 0.05
ICON_WW_THUNDERSTORM = {95, 96, 97, 98, 99}
OverlayFractionFn = Callable[[Mapping[str, float]], tuple[float, float]]


def precip_type_overlay_from_gfs_bytes(
    *,
    input_bands: Mapping[str, ExtractedBand],
    artifact_id: str,
) -> dict[str, bytes]:
    """Return soft snow/mix overlay float32 bytes from GFS precipitation-type inputs."""

    return _precip_type_overlay_bytes(
        input_bands=input_bands,
        input_ids=GFS_PRECIP_TYPE_OVERLAY_INPUT_IDS,
        artifact_id=artifact_id,
        fraction_fn=_gfs_precip_overlay_fractions,
    )


def precip_type_overlay_from_icon_component_rates_bytes(
    *,
    input_bands: Mapping[str, ExtractedBand],
    artifact_id: str,
) -> dict[str, bytes]:
    """Return soft snow/mix overlay float32 bytes from ICON rain/snow component rates."""

    return _precip_type_overlay_bytes(
        input_bands=input_bands,
        input_ids=ICON_PRECIP_TYPE_OVERLAY_INPUT_IDS,
        artifact_id=artifact_id,
        fraction_fn=_icon_precip_overlay_fractions,
    )


def _precip_type_overlay_bytes(
    *,
    input_bands: Mapping[str, ExtractedBand],
    input_ids: tuple[str, ...],
    artifact_id: str,
    fraction_fn: OverlayFractionFn,
) -> dict[str, bytes]:
    bands = {
        input_id: _required_band(input_bands, input_id=input_id, artifact_id=artifact_id)
        for input_id in input_ids
    }
    _validate_equal_lengths(bands.values(), artifact_id=artifact_id)

    component_bytes = len(bands[input_ids[0]].source_f32_bytes)
    snow_out = bytearray(component_bytes)
    mix_out = bytearray(component_bytes)
    iterators = [
        iter_float32_values(bands[input_id].source_f32_bytes, byte_order=bands[input_id].source_byte_order)
        for input_id in input_ids
    ]

    for index, values in enumerate(zip(*iterators, strict=True)):
        source = dict(zip(input_ids, values, strict=True))
        snow_frac, mix_frac = fraction_fn(source)
        struct.pack_into("<f", snow_out, index * 4, snow_frac)
        struct.pack_into("<f", mix_out, index * 4, mix_frac)

    return {
        SNOW_FRACTION_COMPONENT_ID: bytes(snow_out),
        MIX_FRACTION_COMPONENT_ID: bytes(mix_out),
    }


def _gfs_precip_overlay_fractions(source: Mapping[str, float]) -> tuple[float, float]:
    rate = source["precip_rate"]
    if not math.isfinite(rate):
        return math.nan, math.nan

    intensity_mm_hr = rate * 3600.0
    if intensity_mm_hr < PRECIP_TYPE_OVERLAY_MIN_INTENSITY_MM_HR:
        return 0.0, 0.0

    rain = _category_active(source["rain"])
    freezing_rain = _category_active(source["freezing_rain"])
    ice_pellets = _category_active(source["ice_pellets"])
    snow = _category_active(source["snow"])

    if freezing_rain or ice_pellets:
        snow_frac = 0.0
        mix_frac = 1.0
    elif snow and rain:
        snow_frac = 0.25
        mix_frac = 0.75
    elif snow:
        snow_frac = 1.0
        mix_frac = 0.0
    elif rain:
        snow_frac = 0.0
        mix_frac = 0.0
    elif math.isfinite(source["frozen_percent"]):
        frozen_frac = _clamp(source["frozen_percent"] / 100.0, 0.0, 1.0)
        snow_frac = _smoothstep(0.55, 0.85, frozen_frac)
        mix_frac = _smooth_band(frozen_frac, 0.25, 0.75)
    else:
        snow_frac = 0.0
        mix_frac = 0.0

    snow_frac = _clamp(snow_frac, 0.0, 1.0)
    mix_frac = _clamp(mix_frac, 0.0, 1.0 - snow_frac)
    return snow_frac, mix_frac


def _icon_precip_overlay_fractions(source: Mapping[str, float]) -> tuple[float, float]:
    values = [source[input_id] for input_id in ICON_PRECIP_TYPE_OVERLAY_INPUT_IDS]
    if not all(math.isfinite(value) for value in values):
        return math.nan, math.nan

    rain_rate = max(source["rain_gsp"], 0.0) + max(source["rain_con"], 0.0)
    snow_rate = max(source["snow_gsp"], 0.0) + max(source["snow_con"], 0.0)
    total_rate = rain_rate + snow_rate
    intensity_mm_hr = total_rate * 3600.0
    if intensity_mm_hr < PRECIP_TYPE_OVERLAY_MIN_INTENSITY_MM_HR or total_rate <= 0.0:
        return 0.0, 0.0

    snow_ratio = snow_rate / total_rate
    snow_frac = _smoothstep(0.65, 0.95, snow_ratio)
    mix_frac = _smooth_band(snow_ratio, 0.25, 0.75)
    snow_frac = _clamp(snow_frac, 0.0, 1.0)
    mix_frac = _clamp(mix_frac, 0.0, 1.0 - snow_frac)
    return snow_frac, mix_frac


def _category_active(value: float) -> bool:
    return math.isfinite(value) and value >= 0.5


def _clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def _smoothstep(edge0: float, edge1: float, value: float) -> float:
    scaled = _clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def _smooth_band(value: float, low: float, high: float) -> float:
    return _smoothstep(low, 0.5, value) * (1.0 - _smoothstep(0.5, high, value))


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


def _required_band(
    input_bands: Mapping[str, ExtractedBand],
    *,
    input_id: str,
    artifact_id: str,
) -> ExtractedBand:
    try:
        return input_bands[input_id]
    except KeyError:
        raise SystemExit(f"Artifact {artifact_id} derivation missing input {input_id!r}") from None


def _validate_equal_lengths(bands: Iterable[ExtractedBand], *, artifact_id: str) -> None:
    lengths = {len(band.source_f32_bytes) for band in bands}
    if len(lengths) != 1:
        raise SystemExit(f"Artifact {artifact_id} derivation input byte lengths differ: {sorted(lengths)!r}")
