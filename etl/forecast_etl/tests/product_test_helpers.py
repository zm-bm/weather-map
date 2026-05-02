from __future__ import annotations

import hashlib
import json
import struct
from typing import Any

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.config.schema import ProductSpec, ScalarVariableGroup
from forecast_etl.config.validate import parse_product_spec
from forecast_etl.encoding.scalar import (
    encode_scalar_f32_to_payload,
    is_linear_scalar_format,
    scalar_format_for_encoding,
)
from forecast_etl.stores import make_store


def _product_spec(product_id: str, raw: dict) -> ProductSpec:
    return parse_product_spec(product_id=product_id, raw=raw)


def _product_specs(raw_products: dict[str, dict]) -> dict[str, ProductSpec]:
    return {
        product_id: _product_spec(product_id, product_config)
        for product_id, product_config in raw_products.items()
    }


def _scalar_group(
    *,
    group_id: str,
    label: str,
    default_variable: str,
    variables: list[str],
) -> ScalarVariableGroup:
    return ScalarVariableGroup(
        id=group_id,
        label=label,
        default_variable=default_variable,
        variables=tuple(variables),
    )


def _write_json(uri: str, obj: dict) -> None:
    store = make_store()
    store.write_bytes(uri=uri, data=(json.dumps(obj, sort_keys=True) + "\n").encode("utf-8"))


def _pack_f32(values: list[float], *, byte_order: str) -> bytes:
    prefix = "<" if byte_order == "little" else ">"
    return b"".join(struct.pack(f"{prefix}f", float(value)) for value in values)


def _minimal_layer_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "tmp",
        "level": "surface",
        "units": "C",
        "valid_min": -45,
        "valid_max": 50,
        "source_transform": "identity",
        "encoding": {
            "id": "tmp_surface_i16_v1",
            "dtype": "int16",
            "byte_order": "little",
            "scale": 0.01,
            "offset": 0.0,
            "nodata": -32768,
        },
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "GRIB_ELEMENT": "TMP",
                    "GRIB_SHORT_NAME": "2-HTGL",
                },
            }
        ],
    }


def _cloud_layers_config() -> dict:
    return {
        "kind": "scalar",
        "parameter": "cloud_layers",
        "level": "low/medium/high cloud layers",
        "units": "%",
        "valid_min": 0,
        "valid_max": 100,
        "source_transform": "identity",
        "encoding": {
            "id": "cloud_layers_i8_5pct_components_v1",
            "format": "scalar-i8-linear-components-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 5,
            "offset": 0,
            "nodata": -128,
            "component_order": "low_medium_high",
        },
        "components": [
            {"id": "low", "grib_match": {"GRIB_ELEMENT": "LCDC"}},
            {"id": "medium", "grib_match": {"GRIB_ELEMENT": "MCDC"}},
            {"id": "high", "grib_match": {"GRIB_ELEMENT": "HCDC"}},
        ],
    }


def _wind_product_config() -> dict:
    return {
        "kind": "vector",
        "parameter": "wind_uv",
        "level": "10m_above_ground",
        "units": "m/s",
        "valid_min": -64.0,
        "valid_max": 63.5,
        "encoding": {
            "id": "wind10m_uv_vector_i8_v1",
            "format": "uv-i8-q0p5-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.5,
            "offset": 0.0,
            "component_order": "u_then_v",
        },
        "components": [
            {"id": "u", "grib_match": {"GRIB_ELEMENT": "UGRD"}},
            {"id": "v", "grib_match": {"GRIB_ELEMENT": "VGRD"}},
        ],
    }


def _minimal_pipeline_config() -> dict:
    product = _minimal_layer_config()
    return {
        "version": 2,
        "product_catalog": {
            "tmp_surface": _catalog_product(product),
        },
        "models": {
            "gfs": {
                "label": "GFS",
                "source": {
                    "type": "gfs_nomads",
                    "grid_id": "gfs_0p25_global",
                    "base_url": "https://example.test",
                    "vars_levels": {},
                    "rate_limit_seconds": 0.0,
                },
                "workload": {
                    "forecast_hour_start": 0,
                    "forecast_hour_end": 0,
                    "products": ["tmp_surface"],
                },
                "product_bindings": {
                    "tmp_surface": _product_binding(product),
                },
                "scalar_variable_groups": [
                    {
                        "id": "temperature",
                        "label": "Temperature",
                        "default_variable": "tmp_surface",
                        "variables": ["tmp_surface"],
                    },
                ],
            },
        },
    }


def _catalog_product(product_config: dict) -> dict:
    return {
        **{key: value for key, value in product_config.items() if key != "components"},
        "components": [{"id": component["id"]} for component in product_config["components"]],
    }


def _product_binding(product_config: dict) -> dict:
    return {
        "components": [
            {
                "id": component["id"],
                "grib_match": component["grib_match"],
            }
            for component in product_config["components"]
        ],
    }


def _grid_meta_fixture() -> dict[str, Any]:
    return {
        "crs": "EPSG:4326",
        "nx": 4,
        "ny": 3,
        "lon0": -180.0,
        "lat0": 90.0,
        "dx": 0.25,
        "dy": -0.25,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def _small_grid_meta_fixture() -> dict[str, Any]:
    return {
        "crs": "EPSG:4326",
        "nx": 2,
        "ny": 2,
        "lon0": -180.0,
        "lat0": 90.0,
        "dx": 0.25,
        "dy": -0.25,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def _write_scalar_marker(
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
    scalar_format = scalar_format_for_encoding(
        dtype=dtype,
        explicit_format=encoding.get("format"),
    )
    payload = encode_scalar_f32_to_payload(
        source_f32_bytes=_pack_f32(source_values, byte_order="little"),
        source_byte_order="little",
        target_dtype=dtype,
        target_byte_order=str(encoding["byte_order"]),
        target_format=scalar_format,
        scale=float(encoding["scale"]) if is_linear_scalar_format(scalar_format) else None,
        offset=float(encoding["offset"]) if is_linear_scalar_format(scalar_format) else None,
        nodata=int(encoding["nodata"]),
        source_transform=str(product_config.get("source_transform", "identity")),
    )
    payload_sha = hashlib.sha256(payload).hexdigest()
    item = WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
    payload_uri = ap.output_scalar_payload_uri(
        item=item,
        dtype=dtype,
    )
    store.write_bytes(uri=payload_uri, data=payload)
    product_marker = {
        "kind": "scalar",
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": payload_sha,
        "format": scalar_format,
        "dtype": dtype,
        "byte_order": str(encoding["byte_order"]),
        "encoding_id": str(encoding["id"]),
        "nodata": int(encoding["nodata"]),
        "source_transform": str(product_config.get("source_transform", "identity")),
        "units": str(product_config["units"]),
        "parameter": str(product_config["parameter"]),
        "level": str(product_config["level"]),
        "valid_min": float(product_config["valid_min"]),
        "valid_max": float(product_config["valid_max"]),
        "grid_id": "gfs_0p25_global",
        "grid": grid_meta,
    }
    if is_linear_scalar_format(scalar_format):
        product_marker["scale"] = float(encoding["scale"])
        product_marker["offset"] = float(encoding["offset"])
        product_marker["decode_formula"] = "value = stored * scale + offset"

    _write_json(
        ap.success_marker_uri_parts(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "layer": variable,
            "kind": "scalar",
            "product": product_marker,
        },
    )


def _write_packed_cloud_scalar_marker(
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
    scalar_format = scalar_format_for_encoding(
        dtype=dtype,
        explicit_format=encoding.get("format"),
    )
    component_payloads = []
    components = [str(component["id"]) for component in product_config["components"]]
    for component in components:
        component_payloads.append(
            encode_scalar_f32_to_payload(
                source_f32_bytes=_pack_f32(source_values_by_component[component], byte_order="little"),
                source_byte_order="little",
                target_dtype=dtype,
                target_byte_order=str(encoding["byte_order"]),
                target_format=scalar_format,
                scale=float(encoding["scale"]),
                offset=float(encoding["offset"]),
                nodata=int(encoding["nodata"]),
                source_transform=str(product_config.get("source_transform", "identity")),
            )
        )
    payload = b"".join(component_payloads)
    payload_sha = hashlib.sha256(payload).hexdigest()
    item = WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
    payload_uri = ap.output_scalar_payload_uri(item=item, dtype=dtype)
    store.write_bytes(uri=payload_uri, data=payload)
    product_marker = {
        "kind": "scalar",
        "payload_uri": payload_uri,
        "byte_length": len(payload),
        "sha256": payload_sha,
        "format": scalar_format,
        "dtype": dtype,
        "byte_order": str(encoding["byte_order"]),
        "encoding_id": str(encoding["id"]),
        "nodata": int(encoding["nodata"]),
        "scale": float(encoding["scale"]),
        "offset": float(encoding["offset"]),
        "decode_formula": "value = stored * scale + offset",
        "components": components,
        "component_count": len(components),
        "component_order": str(encoding["component_order"]),
        "source_transform": str(product_config.get("source_transform", "identity")),
        "units": str(product_config["units"]),
        "parameter": str(product_config["parameter"]),
        "level": str(product_config["level"]),
        "valid_min": float(product_config["valid_min"]),
        "valid_max": float(product_config["valid_max"]),
        "grid_id": "gfs_0p25_global",
        "grid": grid_meta,
    }

    _write_json(
        ap.success_marker_uri_parts(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "layer": variable,
            "kind": "scalar",
            "product": product_marker,
        },
    )


def _write_vector_marker(
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
    payload_uri = ap.output_vector_payload_uri(
        item=WorkItem(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable, source_uri="file:///dev/null")
    )
    store.write_bytes(uri=payload_uri, data=payload)
    _write_json(
        ap.success_marker_uri_parts(model_id="gfs", cycle=cycle, fhour=fhour, layer=variable),
        {
            "cycle": cycle,
            "fhour": fhour,
            "layer": variable,
            "kind": "vector",
            "product": {
                "kind": "vector",
                "payload_uri": payload_uri,
                "byte_length": len(payload),
                "sha256": payload_sha,
                "format": "uv-i8-q0p5-v1",
                "dtype": "int8",
                "byte_order": "none",
                "scale": 0.5,
                "offset": 0.0,
                "decode_formula": "value = stored * scale + offset",
                "components": ["u", "v"],
                "component_count": 2,
                "component_order": "u_then_v",
                "encoding_id": "wind10m_uv_vector_i8_v1",
                "units": "m/s",
                "parameter": "wind_uv",
                "level": "10m_above_ground",
                "valid_min": -64.0,
                "valid_max": 63.5,
                "grid_id": "gfs_0p25_global",
                "grid": grid_meta,
            },
        },
    )
