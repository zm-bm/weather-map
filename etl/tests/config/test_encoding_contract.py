from __future__ import annotations

import json
import math
import struct
from functools import cache

import pytest
from weather_etl.config.catalog import catalog_requirements
from weather_etl.config.encoding import (
    FORMAT_LINEAR_I8,
    EncodingSpec,
    payload_suffix_for_dtype,
)
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.processing.encoding import encode_component_payload, encode_temp_c_piecewise_i8_value

from tests.fixtures.grids import pack_f32
from tests.fixtures.paths import repo_root_from


def test_payload_suffix_for_dtype_uses_public_payload_filename_contract() -> None:
    assert payload_suffix_for_dtype("int8") == "i8"
    assert payload_suffix_for_dtype("int16") == "i16"
    with pytest.raises(ValueError, match="Unsupported encoding dtype"):
        payload_suffix_for_dtype("float32")


def test_pipeline_artifact_catalog_matches_catalog_sources() -> None:
    source_artifact_ids = catalog_requirements(_catalog()).source_artifact_ids

    assert set(_pipeline_config().artifact_catalog) == source_artifact_ids


def test_linear_i8_encoding_clamps_finite_range_before_quantization() -> None:
    encoding = _linear_i8_encoding(
        scale=0.5,
        offset=0,
        nodata=-128,
        finite_value_range=(0, 2),
    )
    decoded = _decode_linear_i8_payload(
        _encode_values(encoding, (-1, 0, 0.5, 1.5, 2, 3)),
        scale=0.5,
        offset=0,
    )

    assert decoded == [0, 0, 0.5, 1.5, 2, 2]


def test_linear_i8_encoding_preserves_non_finite_values_as_nodata() -> None:
    encoding = _linear_i8_encoding(
        scale=1,
        offset=0,
        nodata=-128,
        finite_value_range=(0, 10),
    )

    assert _unpack_i8(_encode_values(encoding, (float("nan"), float("inf"), float("-inf")))) == [
        -128,
        -128,
        -128,
    ]


def test_linear_i16_encoding_uses_declared_byte_order() -> None:
    encoding = EncodingSpec(
        id="test_i16",
        format="linear-i16-v1",
        dtype="int16",
        byte_order="little",
        scale=2,
        offset=10,
        nodata=-32768,
    )

    assert _encode_values(encoding, (10, 12, 14)) == struct.pack("<hhh", 0, 1, 2)


def test_temperature_piecewise_boundaries_and_clipping() -> None:
    for value in (-35, 0, 50):
        stored = encode_temp_c_piecewise_i8_value(value, nodata=-128)
        decoded = _decode_temp_c_piecewise_i8_value(stored)
        _assert_float_close(decoded, value)

    low_stored = encode_temp_c_piecewise_i8_value(-100, nodata=-128)
    high_stored = encode_temp_c_piecewise_i8_value(100, nodata=-128)
    _assert_float_close(_decode_temp_c_piecewise_i8_value(low_stored), -35)
    _assert_float_close(_decode_temp_c_piecewise_i8_value(high_stored), 50)

    for value in (-7.75, -0.25, 0, 12.5, 34):
        stored = encode_temp_c_piecewise_i8_value(value, nodata=-128)
        decoded = _decode_temp_c_piecewise_i8_value(stored)
        assert abs(decoded - value) <= 0.25 / 2 + 1e-9

    for value in (-35, -20, -8, 34.5, 40, 50):
        stored = encode_temp_c_piecewise_i8_value(value, nodata=-128)
        decoded = _decode_temp_c_piecewise_i8_value(stored)
        assert abs(decoded - value) <= 0.5 / 2 + 1e-9

    assert encode_temp_c_piecewise_i8_value(float("nan"), nodata=-128) == -128


@cache
def _pipeline_config():
    repo_root = repo_root_from(__file__)
    return parse_pipeline_config(
        json.loads((repo_root / "config" / "pipeline.json").read_text(encoding="utf-8"))
    )


@cache
def _catalog() -> dict:
    repo_root = repo_root_from(__file__)
    return json.loads((repo_root / "config" / "catalog.json").read_text(encoding="utf-8"))


def _linear_i8_encoding(
    *,
    scale: float,
    offset: float,
    nodata: int | None,
    finite_value_range: tuple[float, float] | None = None,
) -> EncodingSpec:
    return EncodingSpec(
        id="test_i8",
        format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=scale,
        offset=offset,
        nodata=nodata,
        finite_value_range=(
            None
            if finite_value_range is None
            else {"min": finite_value_range[0], "max": finite_value_range[1]}
        ),
    )


def _encode_values(encoding: EncodingSpec, values: tuple[float, ...]) -> bytes:
    return encode_component_payload(
        source_f32_bytes=pack_f32(values, byte_order="little"),
        source_byte_order="little",
        encoding=encoding,
    )


def _unpack_i8(payload: bytes) -> list[int]:
    return list(struct.unpack(f"{len(payload)}b", payload))


def _decode_linear_i8_payload(payload: bytes, *, scale: float, offset: float) -> list[float]:
    return [stored * scale + offset for stored in _unpack_i8(payload)]


def _decode_temp_c_piecewise_i8_value(stored: int) -> float:
    assert stored != -128
    idx = stored + 127
    if idx <= 54:
        return -35 + idx * 0.5
    if idx <= 222:
        return -7.75 + (idx - 55) * 0.25
    return 34.5 + (idx - 223) * 0.5


def _assert_float_close(actual: float, expected: float) -> None:
    assert math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-9), f"{actual!r} != {expected!r}"
