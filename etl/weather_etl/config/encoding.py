"""Encoding format, dtype, and integer storage contract."""

from __future__ import annotations

import math

from pydantic import StrictInt, model_validator

from ..core.validation import FiniteNumber, FrozenModel, NonEmptyStr

LINEAR_DECODE_FORMULA = "value = stored * scale + offset"
FORMAT_LINEAR_I16 = "linear-i16-v1"
FORMAT_LINEAR_I8 = "linear-i8-v1"
FORMAT_TEMP_C_PIECEWISE_I8 = "temp-c-piecewise-i8-v1"
FORMAT_BY_DTYPE = {
    "int16": FORMAT_LINEAR_I16,
    "int8": FORMAT_LINEAR_I8,
}
DTYPE_BY_FORMAT = {
    FORMAT_LINEAR_I16: "int16",
    FORMAT_LINEAR_I8: "int8",
    FORMAT_TEMP_C_PIECEWISE_I8: "int8",
}
LINEAR_FORMATS = {
    FORMAT_LINEAR_I16,
    FORMAT_LINEAR_I8,
}
BYTE_ORDERS_BY_DTYPE = {
    "int16": {"little", "big"},
    "int8": {"none"},
}
REQUIRED_NODATA_BY_FORMAT = {
    FORMAT_TEMP_C_PIECEWISE_I8: -128,
}
INT_STORAGE_BOUNDS_BY_DTYPE = {
    "int8": (-128, 127),
    "int16": (-32768, 32767),
}
INT_ITEM_BYTES_BY_DTYPE = {
    "int8": 1,
    "int16": 2,
}
PAYLOAD_SUFFIX_BY_DTYPE = {
    "int8": "i8",
    "int16": "i16",
}


def encoding_format_for_spec(*, dtype: str, explicit_format: str | None = None) -> str:
    """Resolve and validate the concrete encoding format for a dtype."""

    if explicit_format is None or explicit_format == "":
        try:
            return FORMAT_BY_DTYPE[dtype]
        except KeyError as exc:
            raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc
    if explicit_format not in DTYPE_BY_FORMAT:
        raise ValueError(f"Unsupported encoding format: {explicit_format!r}")
    expected_dtype = DTYPE_BY_FORMAT[explicit_format]
    if dtype != expected_dtype:
        raise ValueError(
            f"Encoding format {explicit_format!r} requires dtype {expected_dtype!r}, got {dtype!r}"
        )
    return explicit_format


def is_linear_encoding_format(encoding_format: str) -> bool:
    """Return whether an encoding format uses scale/offset decoding."""

    return encoding_format in LINEAR_FORMATS


def required_nodata_for_format(encoding_format: str) -> int | None:
    """Return the required nodata sentinel for a format, if fixed."""

    return REQUIRED_NODATA_BY_FORMAT.get(encoding_format)


def encoding_storage_bounds(dtype: str) -> tuple[int, int]:
    """Return inclusive integer storage bounds for an encoding dtype."""

    try:
        return INT_STORAGE_BOUNDS_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc


def int_item_bytes(dtype: str) -> int:
    """Return bytes per item for a supported integer dtype."""

    try:
        return INT_ITEM_BYTES_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported integer dtype: {dtype!r}") from exc


def payload_suffix_for_dtype(dtype: str) -> str:
    """Return the payload filename suffix for a supported encoding dtype."""

    try:
        return PAYLOAD_SUFFIX_BY_DTYPE[dtype]
    except KeyError as exc:
        raise ValueError(f"Unsupported encoding dtype: {dtype!r}") from exc


class FiniteValueRangeSpec(FrozenModel):
    """Finite transformed-value clamp range applied before quantization."""

    min: FiniteNumber
    max: FiniteNumber

    @model_validator(mode="after")
    def _validate_range(self) -> "FiniteValueRangeSpec":
        if self.max < self.min:
            raise ValueError("finite_value_range.max must be greater than or equal to min")
        return self


class EncodingSpec(FrozenModel):
    """Resolved binary payload encoding contract for one artifact."""

    id: NonEmptyStr
    format: NonEmptyStr
    dtype: NonEmptyStr
    byte_order: NonEmptyStr
    scale: FiniteNumber | None = None
    offset: FiniteNumber | None = None
    nodata: StrictInt | None = None
    finite_value_range: FiniteValueRangeSpec | None = None

    @model_validator(mode="after")
    def _validate_encoding_contract(self) -> "EncodingSpec":
        if self.dtype not in BYTE_ORDERS_BY_DTYPE:
            raise ValueError(
                f"encoding.dtype must be one of {sorted(BYTE_ORDERS_BY_DTYPE)!r}, got: {self.dtype!r}"
            )

        try:
            encoding_format = encoding_format_for_spec(dtype=self.dtype, explicit_format=self.format)
        except ValueError as exc:
            raise ValueError(f"invalid encoding.format: {exc}") from exc

        allowed_byte_orders = BYTE_ORDERS_BY_DTYPE[self.dtype]
        if self.byte_order not in allowed_byte_orders:
            raise ValueError(
                f"encoding.byte_order must be one of {sorted(allowed_byte_orders)!r}, got: {self.byte_order!r}"
            )

        scale, offset = self._validated_scale_offset(encoding_format)
        self._validate_nodata(encoding_format)
        self._validate_finite_value_range(encoding_format=encoding_format, scale=scale, offset=offset)
        return self

    def _validated_scale_offset(self, encoding_format: str) -> tuple[float | None, float | None]:
        if is_linear_encoding_format(encoding_format):
            if self.scale is None:
                raise ValueError("encoding missing required field 'scale'")
            if self.offset is None:
                raise ValueError("encoding missing required field 'offset'")
            if self.scale == 0:
                raise ValueError("encoding.scale must be a finite non-zero number")
            return self.scale, self.offset

        unexpected_linear_fields = sorted(
            field
            for field, value in (("scale", self.scale), ("offset", self.offset))
            if value is not None
        )
        if unexpected_linear_fields:
            raise ValueError(
                f"encoding fields are not supported for format {encoding_format!r}: {unexpected_linear_fields!r}"
            )
        return None, None

    def _validate_nodata(self, encoding_format: str) -> None:
        if self.nodata is not None:
            min_stored, max_stored = encoding_storage_bounds(self.dtype)
            if self.nodata < min_stored or self.nodata > max_stored:
                raise ValueError(
                    f"encoding.nodata must be a {self.dtype} integer ({min_stored}..{max_stored})"
                )

        required_nodata = required_nodata_for_format(encoding_format)
        if required_nodata is not None and self.nodata != required_nodata:
            raise ValueError(f"encoding.nodata must be {required_nodata} for format {encoding_format!r}")

    def _validate_finite_value_range(
        self,
        *,
        encoding_format: str,
        scale: float | None,
        offset: float | None,
    ) -> None:
        if self.finite_value_range is None:
            return

        if not is_linear_encoding_format(encoding_format):
            raise ValueError(
                f"encoding.finite_value_range is not supported for format {encoding_format!r}"
            )
        if scale is None or offset is None:
            raise ValueError("encoding.finite_value_range requires scale and offset")

        min_stored, max_stored = encoding_storage_bounds(self.dtype)
        for label, value in (("min", self.finite_value_range.min), ("max", self.finite_value_range.max)):
            stored = round((value - offset) / scale)
            if stored < min_stored or stored > max_stored:
                raise ValueError(f"encoding.finite_value_range.{label} does not fit {self.dtype} storage")
            decoded = stored * scale + offset
            if not math.isclose(decoded, value, rel_tol=1e-12, abs_tol=abs(scale) * 1e-9):
                raise ValueError(
                    f"encoding.finite_value_range.{label} must be exactly representable by scale and offset"
                )
            if self.nodata is not None and stored == self.nodata:
                raise ValueError(f"encoding.finite_value_range.{label} quantizes to the nodata sentinel")
