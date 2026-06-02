from __future__ import annotations

import struct
import unittest

from forecast_etl.encoding.codecs import (
    FORMAT_LINEAR_I8,
    FORMAT_LINEAR_I16,
    FORMAT_TEMP_C_PIECEWISE_I8,
    encode_component_payload,
)
from forecast_etl.tests.fixtures.grids import pack_f32


class ComponentPayloadTest(unittest.TestCase):
    def test_encode_component_payload_identity_transform_and_target_byte_order(self) -> None:
        source = pack_f32([0.0, 1.0, 2.0], byte_order="little")
        payload = encode_component_payload(
            source_f32_bytes=source,
            source_byte_order="little",
            target_dtype="int16",
            target_byte_order="big",
            target_format=FORMAT_LINEAR_I16,
            scale=0.01,
            offset=0.0,
            nodata=-32768,
        )
        values = [struct.unpack_from(">h", payload, offset=i * 2)[0] for i in range(3)]
        self.assertEqual(values, [0, 100, 200])
        self.assertEqual(len(payload), 3 * 2)

    def test_encode_component_payload_maps_invalid_and_reserves_nodata(self) -> None:
        source = pack_f32([float("nan"), float("inf"), float("-inf"), -40000.0, 40000.0, -32768.0], byte_order="little")
        payload = encode_component_payload(
            source_f32_bytes=source,
            source_byte_order="little",
            target_dtype="int16",
            target_byte_order="little",
            target_format=FORMAT_LINEAR_I16,
            scale=1.0,
            offset=0.0,
            nodata=-32768,
        )
        values = [struct.unpack_from("<h", payload, offset=i * 2)[0] for i in range(6)]
        self.assertEqual(values[0:3], [-32768, -32768, -32768])
        self.assertEqual(values[3], -32767)
        self.assertEqual(values[4], 32767)
        self.assertEqual(values[5], -32767)

        high_nodata_payload = encode_component_payload(
            source_f32_bytes=pack_f32([40000.0], byte_order="little"),
            source_byte_order="little",
            target_dtype="int16",
            target_byte_order="little",
            target_format=FORMAT_LINEAR_I16,
            scale=1.0,
            offset=0.0,
            nodata=32767,
        )
        high_nodata = struct.unpack_from("<h", high_nodata_payload, offset=0)[0]
        self.assertEqual(high_nodata, 32766)

    def test_encode_component_payload_supports_int8_linear_encoding(self) -> None:
        payload = encode_component_payload(
            source_f32_bytes=pack_f32([0.0, 50.0, 100.0, float("nan")], byte_order="little"),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            target_format=FORMAT_LINEAR_I8,
            scale=0.5,
            offset=50.0,
            nodata=-128,
        )

        self.assertEqual(list(struct.unpack("bbbb", payload)), [-100, 0, 100, -128])

    def test_encode_component_payload_preserves_zero_when_nodata_is_absent(self) -> None:
        payload = encode_component_payload(
            source_f32_bytes=pack_f32([float("nan"), 0.0, 1.0], byte_order="little"),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            target_format=FORMAT_LINEAR_I8,
            scale=0.5,
            offset=0.0,
            nodata=None,
        )

        self.assertEqual(list(struct.unpack("bbb", payload)), [0, 0, 2])

    def test_encode_component_payload_applies_value_transform(self) -> None:
        payload = encode_component_payload(
            source_f32_bytes=pack_f32([0.0, 0.001, 0.008333333, float("nan")], byte_order="little"),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            target_format=FORMAT_LINEAR_I8,
            scale=0.15,
            offset=19.05,
            nodata=-128,
            value_transform=lambda value: value * 3600.0,
        )

        self.assertEqual(list(struct.unpack("bbbb", payload)), [-127, -103, 73, -128])

    def test_encode_component_payload_clamps_finite_values_after_transform(self) -> None:
        payload = encode_component_payload(
            source_f32_bytes=pack_f32([-0.001, 0.001, 0.004, float("nan")], byte_order="little"),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            target_format=FORMAT_LINEAR_I8,
            scale=1,
            offset=0,
            nodata=-128,
            value_transform=lambda value: value * 3600.0,
            finite_value_range=(0, 10),
        )

        self.assertEqual(list(struct.unpack("bbbb", payload)), [0, 4, 10, -128])

    def test_encode_component_payload_supports_temperature_piecewise_encoding(self) -> None:
        payload = encode_component_payload(
            source_f32_bytes=pack_f32(
                [-100.0, -35.0, -8.0, -7.75, 34.0, 34.5, 50.0, 100.0, float("nan")],
                byte_order="little",
            ),
            source_byte_order="little",
            target_dtype="int8",
            target_byte_order="none",
            target_format=FORMAT_TEMP_C_PIECEWISE_I8,
            nodata=-128,
        )

        self.assertEqual(list(struct.unpack("bbbbbbbbb", payload)), [-127, -127, -73, -72, 95, 96, 127, 127, -128])
