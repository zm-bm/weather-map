from __future__ import annotations

import hashlib
import json
from typing import Any

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.encoding.codecs import (
    encode_component_payload,
    encoding_format_for_spec,
    is_linear_encoding_format,
)
from forecast_etl.products.transforms import source_value_transform
from forecast_etl.stores import make_store

from .grids import pack_f32


def write_json(uri: str, obj: dict) -> None:
    store = make_store()
    store.write_bytes(uri=uri, data=(json.dumps(obj, sort_keys=True) + "\n").encode("utf-8"))


def write_scalar_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    source_values: list[float],
    product_config: dict,
    grid_meta: dict[str, Any],
) -> None:
    encoding = product_config["encoding"]
    dtype = str(encoding["dtype"])
    encoding_format = encoding_format_for_spec(
        dtype=dtype,
        explicit_format=encoding.get("format"),
    )
    payload = encode_component_payload(
        source_f32_bytes=pack_f32(source_values, byte_order="little"),
        source_byte_order="little",
        target_dtype=dtype,
        target_byte_order=str(encoding["byte_order"]),
        target_format=encoding_format,
        scale=float(encoding["scale"]) if is_linear_encoding_format(encoding_format) else None,
        offset=float(encoding["offset"]) if is_linear_encoding_format(encoding_format) else None,
        nodata=int(encoding["nodata"]),
        value_transform=source_value_transform(str(product_config.get("source_transform", "identity"))),
    )
    payload_sha = hashlib.sha256(payload).hexdigest()
    item = WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable, source_uri="file:///dev/null")
    payload_uri = ap.output_field_payload_uri(
        item=item,
        dtype=dtype,
    )
    store.write_bytes(uri=payload_uri, data=payload)
    product_marker = {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": payload_sha,
        "format": encoding_format,
        "encoding_id": str(encoding["id"]),
        "units": str(product_config["units"]),
        "parameter": str(product_config["parameter"]),
        "level": str(product_config["level"]),
        "valid_min": float(product_config["valid_min"]),
        "valid_max": float(product_config["valid_max"]),
        "components": [str(component["id"]) for component in product_config["components"]],
        "style": {
            "layer_id": str(product_config["style"]["layer_id"]),
            "palette_id": str(product_config["style"]["palette_id"]),
        },
        "grid_id": "gfs_0p25_global",
        "grid": grid_meta,
    }

    write_json(
        ap.success_marker_uri_parts(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "product_id": variable,
            "product": product_marker,
        },
    )


def write_cloud_layers_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    source_values_by_component: dict[str, list[float]],
    product_config: dict,
    grid_meta: dict[str, Any],
) -> None:
    encoding = product_config["encoding"]
    dtype = str(encoding["dtype"])
    encoding_format = encoding_format_for_spec(
        dtype=dtype,
        explicit_format=encoding.get("format"),
    )
    component_payloads = []
    components = [str(component["id"]) for component in product_config["components"]]
    for component in components:
        component_payloads.append(
            encode_component_payload(
                source_f32_bytes=pack_f32(source_values_by_component[component], byte_order="little"),
                source_byte_order="little",
                target_dtype=dtype,
                target_byte_order=str(encoding["byte_order"]),
                target_format=encoding_format,
                scale=float(encoding["scale"]),
                offset=float(encoding["offset"]),
                nodata=int(encoding["nodata"]),
                value_transform=source_value_transform(str(product_config.get("source_transform", "identity"))),
            )
        )
    payload = b"".join(component_payloads)
    payload_sha = hashlib.sha256(payload).hexdigest()
    item = WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable, source_uri="file:///dev/null")
    payload_uri = ap.output_field_payload_uri(item=item, dtype=dtype)
    store.write_bytes(uri=payload_uri, data=payload)
    product_marker = {
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": payload_sha,
        "format": encoding_format,
        "encoding_id": str(encoding["id"]),
        "components": components,
        "units": str(product_config["units"]),
        "parameter": str(product_config["parameter"]),
        "level": str(product_config["level"]),
        "valid_min": float(product_config["valid_min"]),
        "valid_max": float(product_config["valid_max"]),
        "style": {
            "layer_id": str(product_config["style"]["layer_id"]),
            "palette_id": str(product_config["style"]["palette_id"]),
        },
        "grid_id": "gfs_0p25_global",
        "grid": grid_meta,
    }

    write_json(
        ap.success_marker_uri_parts(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "product_id": variable,
            "product": product_marker,
        },
    )


def write_vector_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    fhour: str,
    variable: str,
    grid_meta: dict[str, Any],
) -> None:
    component_bytes = int(grid_meta["nx"]) * int(grid_meta["ny"])
    u_bytes = bytes((i % 128) for i in range(component_bytes))
    v_bytes = bytes(((i + 7) % 128) for i in range(component_bytes))
    payload = u_bytes + v_bytes
    payload_sha = hashlib.sha256(payload).hexdigest()
    payload_uri = ap.output_field_payload_uri(
        item=WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable, source_uri="file:///dev/null"),
        dtype="int8",
    )
    store.write_bytes(uri=payload_uri, data=payload)
    write_json(
        ap.success_marker_uri_parts(model_id="gfs", cycle=cycle, fhour=fhour, product_id=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "product_id": variable,
            "product": {
                "payload_uri": payload_uri,
                "byte_length": len(payload),
                "sha256": payload_sha,
                "format": "linear-i8-v1",
                "components": ["u", "v"],
                "encoding_id": "wind10m_uv_vector_i8_v1",
                "units": "m/s",
                "parameter": "wind_uv",
                "level": "10m_above_ground",
                "valid_min": -64.0,
                "valid_max": 63.5,
                "style": {
                    "layer_id": "vector",
                    "palette_id": "wind.vector.mps.v1",
                },
                "grid_id": "gfs_0p25_global",
                "grid": grid_meta,
            },
        },
    )
