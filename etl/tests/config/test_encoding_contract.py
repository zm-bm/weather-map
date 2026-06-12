from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from functools import cache

import pytest
from weather_etl.config.catalog import catalog_requirements
from weather_etl.config.encoding import (
    FORMAT_LINEAR_I8,
    FORMAT_TEMP_C_PIECEWISE_I8,
    EncodingSpec,
    encoding_storage_bounds,
    payload_suffix_for_dtype,
)
from weather_etl.config.pipeline import PipelineArtifactSpec, parse_pipeline_config
from weather_etl.processing.encoding import encode_component_payload, encode_temp_c_piecewise_i8_value

from tests.fixtures.grids import pack_f32
from tests.fixtures.paths import repo_root_from


def test_payload_suffix_for_dtype_uses_public_payload_filename_contract() -> None:
    assert payload_suffix_for_dtype("int8") == "i8"
    assert payload_suffix_for_dtype("int16") == "i16"
    with pytest.raises(ValueError, match="Unsupported encoding dtype"):
        payload_suffix_for_dtype("float32")


@dataclass(frozen=True)
class EncodingContract:
    artifact_id: str
    kind: str
    units: str
    components: tuple[str, ...]
    source_transform: str
    encoding_id: str
    encoding_format: str
    dtype: str
    byte_order: str
    scale: float | None = None
    offset: float | None = None
    nodata: int | None = None
    finite_range: tuple[float, float] | None = None
    display_range: tuple[float, float] | None = None
    storage_range: tuple[float, float] | None = None
    required_precision: float | None = None
    exact_values: tuple[float, ...] = ()
    threshold_values: tuple[float, ...] = ()


CONTRACTS: dict[str, EncodingContract] = {
    "tmp_surface": EncodingContract(
        artifact_id="tmp_surface",
        kind="scalar",
        units="C",
        components=("value",),
        source_transform="identity",
        encoding_id="tmp_surface_i8_temp_c_piecewise_v1",
        encoding_format=FORMAT_TEMP_C_PIECEWISE_I8,
        dtype="int8",
        byte_order="none",
        nodata=-128,
        display_range=(-35, 50),
        required_precision=0.5,
        exact_values=(-35, 0, 50),
    ),
    "aptmp_surface": EncodingContract(
        artifact_id="aptmp_surface",
        kind="scalar",
        units="C",
        components=("value",),
        source_transform="identity",
        encoding_id="tmp_surface_i8_temp_c_piecewise_v1",
        encoding_format=FORMAT_TEMP_C_PIECEWISE_I8,
        dtype="int8",
        byte_order="none",
        nodata=-128,
        display_range=(-35, 50),
        required_precision=0.5,
        exact_values=(-35, 0, 50),
    ),
    "dewpoint_surface": EncodingContract(
        artifact_id="dewpoint_surface",
        kind="scalar",
        units="C",
        components=("value",),
        source_transform="identity",
        encoding_id="dewpoint_surface_i8_0p5c_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.5,
        offset=0,
        nodata=-128,
        display_range=(-60, 40),
        storage_range=(-63.5, 63.5),
        required_precision=0.5,
        exact_values=(-60, 0, 40),
        threshold_values=(-20, -10, 10, 16, 18, 21, 24, 27),
    ),
    "rh_surface": EncodingContract(
        artifact_id="rh_surface",
        kind="scalar",
        units="%",
        components=("value",),
        source_transform="identity",
        encoding_id="rh_surface_i8_1pct_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=1,
        offset=50,
        nodata=-128,
        finite_range=(0, 100),
        display_range=(0, 100),
        storage_range=(-77, 177),
        required_precision=1,
        exact_values=(0, 100),
        threshold_values=(10, 25, 50, 75, 90),
    ),
    "gust_surface": EncodingContract(
        artifact_id="gust_surface",
        kind="scalar",
        units="m/s",
        components=("value",),
        source_transform="identity",
        encoding_id="gust_surface_i8_0p5ms_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.5,
        offset=63.5,
        nodata=-128,
        finite_range=(0, 60),
        display_range=(0, 60),
        storage_range=(0, 127),
        required_precision=0.5,
        exact_values=(0, 60),
        threshold_values=(5, 10, 15, 17, 25, 33, 50, 60),
    ),
    "prmsl_msl": EncodingContract(
        artifact_id="prmsl_msl",
        kind="scalar",
        units="Pa",
        components=("value",),
        source_transform="identity",
        encoding_id="prmsl_msl_i8_50pa_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=50,
        offset=100500,
        nodata=-128,
        finite_range=(94150, 106850),
        display_range=(98000, 103600),
        storage_range=(94150, 106850),
        required_precision=50,
        exact_values=(98000, 103600),
        threshold_values=(101325, *tuple(range(98000, 103601, 400))),
    ),
    "tcdc": EncodingContract(
        artifact_id="tcdc",
        kind="scalar",
        units="%",
        components=("value",),
        source_transform="identity",
        encoding_id="tcdc_i8_4pct_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=4,
        offset=0,
        nodata=-128,
        finite_range=(0, 100),
        display_range=(0, 100),
        storage_range=(-508, 508),
        required_precision=4,
        exact_values=(0, 100),
        threshold_values=(10, 25, 50, 75, 90),
    ),
    "cloud_layers": EncodingContract(
        artifact_id="cloud_layers",
        kind="vector",
        units="%",
        components=("low", "middle", "high"),
        source_transform="identity",
        encoding_id="cloud_layers_vector_i8_4pct_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=4,
        offset=0,
        nodata=-128,
        finite_range=(0, 100),
        display_range=(0, 100),
        storage_range=(-508, 508),
        required_precision=4,
        exact_values=(0, 100),
        threshold_values=(10, 25, 50, 75, 90),
    ),
    "prate_surface": EncodingContract(
        artifact_id="prate_surface",
        kind="scalar",
        units="mm/hr",
        components=("value",),
        source_transform="kg_m2_s_to_mm_hr",
        encoding_id="prate_surface_i8_0p15mmhr_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.15,
        offset=19.05,
        nodata=-128,
        finite_range=(0, 38.1),
        display_range=(0, 30),
        storage_range=(0, 38.1),
        required_precision=0.15,
        exact_values=(0, 30, 38.1),
        threshold_values=(0.15, 0.3, 0.75, 1.5, 3, 7.5, 12, 25, 30),
    ),
    "precip_total_surface": EncodingContract(
        artifact_id="precip_total_surface",
        kind="scalar",
        units="mm",
        components=("value",),
        source_transform="identity",
        encoding_id="precip_total_surface_i8_1mm_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=1,
        offset=127,
        nodata=-128,
        finite_range=(0, 254),
        display_range=(0, 254),
        storage_range=(0, 254),
        required_precision=1,
        exact_values=(0, 254),
        threshold_values=(1, 5, 10, 25, 50, 100, 150, 250),
    ),
    "precip_type_surface": EncodingContract(
        artifact_id="precip_type_surface",
        kind="vector",
        units="fraction",
        components=("snow_frac", "mix_frac"),
        source_transform="identity",
        encoding_id="precip_type_surface_i8_frac_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.003937007874015748,
        offset=0.5,
        nodata=-128,
        finite_range=(0, 1),
        display_range=(0, 1),
        storage_range=(0, 1),
        required_precision=0.003937007874015748,
        exact_values=(0, 1),
        threshold_values=(0.25, 0.5, 0.75),
    ),
    "thunderstorm_mask": EncodingContract(
        artifact_id="thunderstorm_mask",
        kind="scalar",
        units="flag",
        components=("value",),
        source_transform="identity",
        encoding_id="thunderstorm_mask_i8_flag_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=1,
        offset=0,
        nodata=-128,
        finite_range=(0, 1),
        display_range=(0, 1),
        storage_range=(-127, 127),
        required_precision=1,
        exact_values=(0, 1),
    ),
    "snow_depth_surface": EncodingContract(
        artifact_id="snow_depth_surface",
        kind="scalar",
        units="m",
        components=("value",),
        source_transform="identity",
        encoding_id="snow_depth_surface_i8_0p012m_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=3 / 254,
        offset=1.5,
        nodata=-128,
        finite_range=(0, 3),
        display_range=(0, 3),
        storage_range=(0, 3),
        required_precision=3 / 254,
        exact_values=(0, 3),
        threshold_values=(0.02, 0.05, 0.1, 0.5, 1, 3),
    ),
    "visibility_surface": EncodingContract(
        artifact_id="visibility_surface",
        kind="scalar",
        units="m",
        components=("value",),
        source_transform="identity",
        encoding_id="visibility_surface_i8_200m_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=200,
        offset=25400,
        nodata=-128,
        finite_range=(0, 50800),
        display_range=(0, 50000),
        storage_range=(0, 50800),
        required_precision=200,
        exact_values=(0, 50000, 50800),
        threshold_values=(500, 1000, 1600, 5000, 10000, 20000),
    ),
    "freezing_level": EncodingContract(
        artifact_id="freezing_level",
        kind="scalar",
        units="m",
        components=("value",),
        source_transform="identity",
        encoding_id="freezing_level_i8_32m_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=32,
        offset=4064,
        nodata=-128,
        finite_range=(0, 8128),
        display_range=(0, 8000),
        storage_range=(0, 8128),
        required_precision=32,
        exact_values=(0, 8000, 8128),
        threshold_values=(500, 1000, 1500, 2500, 3500, 5000, 6500),
    ),
    "precipitable_water": EncodingContract(
        artifact_id="precipitable_water",
        kind="scalar",
        units="mm",
        components=("value",),
        source_transform="identity",
        encoding_id="precipitable_water_i8_0p32mm_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.32,
        offset=40.64,
        nodata=-128,
        finite_range=(0, 81.28),
        display_range=(0, 80),
        storage_range=(0, 81.28),
        required_precision=0.32,
        exact_values=(0, 80, 81.28),
        threshold_values=(10, 20, 30, 40, 50, 65),
    ),
    "cape_index": EncodingContract(
        artifact_id="cape_index",
        kind="scalar",
        units="J/kg",
        components=("value",),
        source_transform="identity",
        encoding_id="cape_index_i8_20jkg_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=20,
        offset=2540,
        nodata=-128,
        finite_range=(0, 5080),
        display_range=(0, 5000),
        storage_range=(0, 5080),
        required_precision=20,
        exact_values=(0, 5000, 5080),
        threshold_values=(250, 500, 1000, 1500, 2500, 3500),
    ),
    "cin_index": EncodingContract(
        artifact_id="cin_index",
        kind="scalar",
        units="J/kg",
        components=("value",),
        source_transform="cin_magnitude",
        encoding_id="cin_index_i8_2jkg_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=2,
        offset=254,
        nodata=-128,
        finite_range=(0, 508),
        display_range=(0, 500),
        storage_range=(0, 508),
        required_precision=2,
        exact_values=(0, 500, 508),
        threshold_values=(25, 50, 100, 200, 300),
    ),
    "refc_entire_atmosphere": EncodingContract(
        artifact_id="refc_entire_atmosphere",
        kind="scalar",
        units="dBZ",
        components=("value",),
        source_transform="identity",
        encoding_id="refc_entire_atmosphere_i8_0p5dbz_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.5,
        offset=31.5,
        nodata=-128,
        finite_range=(0, 75),
        display_range=(0, 75),
        storage_range=(-32, 95),
        required_precision=0.5,
        exact_values=(0, 75),
        threshold_values=(5, 10, 20, 30, 40, 50, 60, 70),
    ),
    "observed_radar_base_reflectivity": EncodingContract(
        artifact_id="observed_radar_base_reflectivity",
        kind="scalar",
        units="dBZ",
        components=("value",),
        source_transform="identity",
        encoding_id="observed_radar_base_reflectivity_i8_0p5dbz_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.5,
        offset=31.5,
        nodata=-128,
        finite_range=(0, 75),
        display_range=(0, 75),
        storage_range=(-32, 95),
        required_precision=0.5,
        exact_values=(0, 75),
        threshold_values=(5, 10, 20, 30, 40, 50, 60, 70),
    ),
    "observed_radar_composite_reflectivity": EncodingContract(
        artifact_id="observed_radar_composite_reflectivity",
        kind="scalar",
        units="dBZ",
        components=("value",),
        source_transform="identity",
        encoding_id="observed_radar_composite_reflectivity_i8_0p5dbz_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=0.5,
        offset=31.5,
        nodata=-128,
        finite_range=(0, 75),
        display_range=(0, 75),
        storage_range=(-32, 95),
        required_precision=0.5,
        exact_values=(0, 75),
        threshold_values=(5, 10, 20, 30, 40, 50, 60, 70),
    ),
    "wind10m_uv": EncodingContract(
        artifact_id="wind10m_uv",
        kind="vector",
        units="m/s",
        components=("u", "v"),
        source_transform="identity",
        encoding_id="wind10m_uv_vector_i8_1ms_v1",
        encoding_format=FORMAT_LINEAR_I8,
        dtype="int8",
        byte_order="none",
        scale=1,
        offset=0,
        nodata=None,
        finite_range=(-64, 64),
        display_range=(-60, 60),
        storage_range=(-128, 127),
        required_precision=1,
        exact_values=(-60, 0, 60),
    ),
}


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


def test_every_field_source_artifact_has_encoding_contract() -> None:
    source_artifact_ids = catalog_requirements(_catalog()).source_artifact_ids

    assert source_artifact_ids <= set(CONTRACTS)


def test_every_encoding_contract_exists_in_artifact_catalog() -> None:
    assert set(CONTRACTS) <= set(_pipeline_config().artifact_catalog)


def test_artifact_config_matches_encoding_contract() -> None:
    for artifact_id, contract in CONTRACTS.items():
        artifact = _pipeline_config().artifact_catalog[artifact_id]
        encoding = artifact.encoding

        assert artifact.kind == contract.kind
        assert artifact.units == contract.units
        assert artifact.source_transform == contract.source_transform
        assert artifact.component_ids == contract.components
        assert encoding.id == contract.encoding_id
        assert encoding.format == contract.encoding_format
        assert encoding.dtype == contract.dtype
        assert encoding.byte_order == contract.byte_order
        _assert_optional_float_equal(encoding.scale, contract.scale)
        _assert_optional_float_equal(encoding.offset, contract.offset)
        assert encoding.nodata == contract.nodata
        assert _finite_range_tuple(artifact) == contract.finite_range


def test_linear_encoding_storage_ranges_precision_and_display_coverage() -> None:
    for artifact_id, contract in CONTRACTS.items():
        if contract.encoding_format != FORMAT_LINEAR_I8:
            continue
        artifact = _pipeline_config().artifact_catalog[artifact_id]
        storage_range = _decoded_storage_range(artifact)

        assert contract.storage_range is not None
        _assert_float_tuple_close(storage_range, contract.storage_range)

        assert contract.required_precision is not None
        assert contract.scale is not None
        assert abs(contract.scale) <= contract.required_precision

        if contract.display_range is not None:
            coverage_range = contract.finite_range or storage_range
            assert coverage_range[0] <= contract.display_range[0]
            assert coverage_range[1] >= contract.display_range[1]


def test_linear_encoding_exact_values_are_representable() -> None:
    for artifact_id, contract in CONTRACTS.items():
        if contract.encoding_format != FORMAT_LINEAR_I8:
            continue

        values = contract.exact_values
        if contract.finite_range is not None:
            values = values + contract.finite_range

        for value in values:
            artifact = _pipeline_config().artifact_catalog[artifact_id]
            stored = _stored_value_for_linear_contract(contract, value)
            _assert_stored_value_is_usable(artifact, stored)
            decoded = _decode_linear_contract(contract, stored)
            _assert_float_close(decoded, value)


def test_linear_encoding_threshold_values_are_within_half_quantum() -> None:
    for artifact_id, contract in CONTRACTS.items():
        if contract.encoding_format != FORMAT_LINEAR_I8:
            continue

        assert contract.scale is not None
        tolerance = abs(contract.scale) / 2
        for value in contract.threshold_values:
            artifact = _pipeline_config().artifact_catalog[artifact_id]
            stored = _stored_value_for_linear_contract(contract, value)
            _assert_stored_value_is_usable(artifact, stored)
            decoded = _decode_linear_contract(contract, stored)
            assert abs(decoded - value) <= tolerance + 1e-9


def test_finite_linear_encodings_clamp_boundaries_before_quantization() -> None:
    for artifact_id, contract in CONTRACTS.items():
        if contract.encoding_format != FORMAT_LINEAR_I8 or contract.finite_range is None:
            continue

        assert contract.scale is not None
        lower, upper = contract.finite_range
        quantum = abs(contract.scale)
        test_values = (
            lower - quantum,
            lower,
            lower + quantum,
            upper - quantum,
            upper,
            upper + quantum,
        )
        expected = (
            lower,
            lower,
            lower + quantum,
            upper - quantum,
            upper,
            upper,
        )
        decoded = _encode_decode_linear_values(contract, test_values)

        for actual, expected_value in zip(decoded, expected):
            _assert_float_close(actual, expected_value)


def test_linear_encodings_with_nodata_preserve_non_finite_values_as_nodata() -> None:
    for artifact_id, contract in CONTRACTS.items():
        if contract.encoding_format != FORMAT_LINEAR_I8 or contract.nodata is None:
            continue
        stored_values = _encode_linear_values(contract, (float("nan"), float("inf"), float("-inf")))

        assert stored_values == [contract.nodata, contract.nodata, contract.nodata]


def test_temperature_piecewise_boundaries_and_clipping() -> None:
    for artifact_id in ("tmp_surface", "aptmp_surface"):
        contract = CONTRACTS[artifact_id]
        assert contract.encoding_format == FORMAT_TEMP_C_PIECEWISE_I8
        assert contract.nodata == -128

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


def _finite_range_tuple(artifact: PipelineArtifactSpec) -> tuple[float, float] | None:
    finite_range = artifact.encoding.finite_value_range
    if finite_range is None:
        return None
    return (finite_range.min, finite_range.max)


def _decoded_storage_range(artifact: PipelineArtifactSpec) -> tuple[float, float]:
    encoding = artifact.encoding
    assert encoding.scale is not None
    assert encoding.offset is not None
    min_stored, max_stored = encoding_storage_bounds(encoding.dtype)
    if encoding.nodata == min_stored:
        min_stored += 1
    if encoding.nodata == max_stored:
        max_stored -= 1
    return (
        min_stored * encoding.scale + encoding.offset,
        max_stored * encoding.scale + encoding.offset,
    )


def _stored_value_for_linear_contract(contract: EncodingContract, value: float) -> int:
    assert contract.scale is not None
    assert contract.offset is not None
    return int(round((value - contract.offset) / contract.scale))


def _decode_linear_contract(contract: EncodingContract, stored: int) -> float:
    assert contract.scale is not None
    assert contract.offset is not None
    return stored * contract.scale + contract.offset


def _encode_decode_linear_values(contract: EncodingContract, values: tuple[float, ...]) -> list[float]:
    return [_decode_linear_contract(contract, stored) for stored in _encode_linear_values(contract, values)]


def _encode_linear_values(contract: EncodingContract, values: tuple[float, ...]) -> list[int]:
    payload = encode_component_payload(
        source_f32_bytes=pack_f32(values, byte_order="little"),
        source_byte_order="little",
        encoding=_encoding_spec_for_contract(contract),
    )
    if contract.dtype == "int8":
        return list(struct.unpack(f"{len(values)}b", payload))
    if contract.dtype == "int16":
        fmt = "<" if contract.byte_order == "little" else ">"
        return list(struct.unpack(f"{fmt}{len(values)}h", payload))
    raise AssertionError(f"Unsupported dtype in test contract: {contract.dtype!r}")


def _encoding_spec_for_contract(contract: EncodingContract) -> EncodingSpec:
    return EncodingSpec(
        id=contract.encoding_id,
        dtype=contract.dtype,
        byte_order=contract.byte_order,
        format=contract.encoding_format,
        scale=contract.scale,
        offset=contract.offset,
        nodata=contract.nodata,
        finite_value_range=(
            None
            if contract.finite_range is None
            else {"min": contract.finite_range[0], "max": contract.finite_range[1]}
        ),
    )


def _decode_temp_c_piecewise_i8_value(stored: int) -> float:
    if stored == -128:
        raise AssertionError("Cannot decode nodata as temperature")
    idx = stored + 127
    if idx <= 54:
        return -35 + idx * 0.5
    if idx <= 222:
        return -7.75 + (idx - 55) * 0.25
    return 34.5 + (idx - 223) * 0.5


def _assert_stored_value_is_usable(
    artifact: PipelineArtifactSpec,
    stored: int,
) -> None:
    min_stored, max_stored = encoding_storage_bounds(artifact.encoding.dtype)
    assert stored >= min_stored
    assert stored <= max_stored
    assert stored != artifact.encoding.nodata


def _assert_optional_float_equal(
    actual: float | None,
    expected: float | None,
) -> None:
    if expected is None:
        assert actual is None
    else:
        assert actual is not None
        _assert_float_close(actual, expected)


def _assert_float_tuple_close(
    actual: tuple[float, float],
    expected: tuple[float, float],
) -> None:
    _assert_float_close(actual[0], expected[0])
    _assert_float_close(actual[1], expected[1])


def _assert_float_close(actual: float, expected: float) -> None:
    assert math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-9), f"{actual!r} != {expected!r}"
