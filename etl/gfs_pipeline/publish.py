"""Publish role: idempotent readiness check + forecast manifest writer.

Behavior:
- Compute expected success markers for ctx.forecast_hours.
- If any are missing: return not-ready.
- If all present and `_PUBLISHED.json` exists with SAME revision: return already-published.
- Else: write cycle manifest and then write `_PUBLISHED.json`.

This module performs no direct filesystem/S3 operations; all I/O goes through
the UriStore interface.
"""

from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Any, Mapping
from urllib.parse import urlparse

from .stores import make_store
from .stores.base import UriStore
from .config import ExecutionContext
from .contracts import ArtifactPaths, SUCCESS_MARKER_SUFFIX

FORECAST_BINARY_CONTRACT = "forecast-binary-v2"
MANIFEST_VERSION = 4
WEATHER_SCALAR_FORMAT = "scalar-i16-linear-v1"
WEATHER_SCALAR_DECODE_FORMULA = "value = stored * scale + offset"
WEATHER_SCALAR_GRID_ID = "gfs_0p25_global"


def _utc_now_iso() -> str:
    """Current UTC timestamp as ISO-8601 string (seconds precision)."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _compute_manifest_revision(
    *,
    cycle: str,
    hours: Iterable[str],
    scalar_variables: Iterable[str],
    vector_variables: Iterable[str],
    grids: Mapping[str, Mapping[str, Any]],
    encodings: Mapping[str, Mapping[str, Any]],
    variable_meta: Mapping[str, Mapping[str, Any]],
    frames: Mapping[str, Mapping[str, Mapping[str, Any]]],
) -> str:
    """Compute a stable, short revision string for cycle manifests."""
    basis = {
        "version": MANIFEST_VERSION,
        "contract": FORECAST_BINARY_CONTRACT,
        "cycle": cycle,
        "forecast_hours": list(hours),
        "scalar_variables": list(scalar_variables),
        "vector_variables": list(vector_variables),
        "grids": grids,
        "encodings": encodings,
        "variable_meta": variable_meta,
        "frames": frames,
    }
    digest = hashlib.sha256(json.dumps(basis, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]


def _list_success_markers(*, store: UriStore, ap: ArtifactPaths, cycle: str) -> set[str]:
    prefix = ap.status_prefix_uri(cycle=cycle)
    uris = store.list_prefix(prefix_uri=prefix)
    return {u for u in uris if u.endswith(SUCCESS_MARKER_SUFFIX)}


def _expected_success_markers(
    *,
    ap: ArtifactPaths,
    cycle: str,
    fhours: Iterable[str],
    scalar_variables: Iterable[str],
    vector_variables: Iterable[str] = (),
) -> set[str]:
    expected: set[str] = set()
    for layer in scalar_variables:
        for fhour in fhours:
            expected.add(ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=layer))
    for layer in vector_variables:
        for fhour in fhours:
            expected.add(ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=layer))
    return expected


def _write_json(*, store: UriStore, uri: str, obj: dict) -> None:
    store.write_bytes(
        uri=uri,
        data=(json.dumps(obj, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )


def _read_json(*, store: UriStore, uri: str) -> dict[str, Any]:
    data = store.read_bytes(uri=uri)
    return json.loads(data.decode("utf-8"))


def _as_str(raw: Any, *, field: str) -> str:
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    raise SystemExit(f"Invalid or missing string field {field!r}: {raw!r}")


def _as_int(raw: Any, *, field: str) -> int:
    if isinstance(raw, int):
        return int(raw)
    raise SystemExit(f"Invalid or missing integer field {field!r}: {raw!r}")


def _as_float(raw: Any, *, field: str) -> float:
    if isinstance(raw, (int, float)):
        return float(raw)
    raise SystemExit(f"Invalid or missing numeric field {field!r}: {raw!r}")


def _normalize_grid(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise SystemExit(f"scalar.grid must be an object, got: {raw!r}")

    return {
        "crs": _as_str(raw.get("crs"), field="scalar.grid.crs"),
        "nx": _as_int(raw.get("nx"), field="scalar.grid.nx"),
        "ny": _as_int(raw.get("ny"), field="scalar.grid.ny"),
        "lon0": _as_float(raw.get("lon0"), field="scalar.grid.lon0"),
        "lat0": _as_float(raw.get("lat0"), field="scalar.grid.lat0"),
        "dx": _as_float(raw.get("dx"), field="scalar.grid.dx"),
        "dy": _as_float(raw.get("dy"), field="scalar.grid.dy"),
        "origin": _as_str(raw.get("origin"), field="scalar.grid.origin"),
        "layout": _as_str(raw.get("layout"), field="scalar.grid.layout"),
        "x_wrap": _as_str(raw.get("x_wrap"), field="scalar.grid.x_wrap"),
        "y_mode": _as_str(raw.get("y_mode"), field="scalar.grid.y_mode"),
    }


def _register_grid(
    *,
    grids: dict[str, dict[str, Any]],
    grid_id: str,
    grid: dict[str, Any],
    context: str,
) -> None:
    previous = grids.get(grid_id)
    if previous is None:
        grids[grid_id] = grid
        return
    if previous != grid:
        raise SystemExit(f"Grid mismatch for grid_id={grid_id!r} while processing {context}")


def _as_str_list(raw: Any, *, field: str) -> list[str]:
    if not isinstance(raw, list) or not raw:
        raise SystemExit(f"Invalid or missing string list field {field!r}: {raw!r}")
    out: list[str] = []
    for idx, value in enumerate(raw):
        out.append(_as_str(value, field=f"{field}[{idx}]"))
    return out


def _relative_artifact_path(*, artifact_root_uri: str, uri: str) -> str:
    root = urlparse(artifact_root_uri)
    target = urlparse(uri)
    if root.scheme != target.scheme or root.netloc != target.netloc:
        raise SystemExit(
            f"Cannot derive relative artifact path: root={artifact_root_uri!r} uri={uri!r}"
        )

    root_path = root.path.rstrip("/")
    target_path = target.path
    prefix = f"{root_path}/" if root_path else "/"
    if not target_path.startswith(prefix):
        raise SystemExit(
            f"Payload URI is outside artifact root: root={artifact_root_uri!r} uri={uri!r}"
        )

    rel = target_path[len(prefix):]
    if not rel:
        raise SystemExit(f"Payload URI resolved to empty relative path: {uri!r}")
    return rel


def _read_latest_cycle(*, store: UriStore, latest_manifest_uri: str) -> str | None:
    if not store.exists(uri=latest_manifest_uri):
        return None

    try:
        latest = _read_json(store=store, uri=latest_manifest_uri)
    except Exception as exc:
        print(f"Unable to read current latest manifest {latest_manifest_uri}: {exc}")
        return None

    cycle_raw = latest.get("cycle")
    if isinstance(cycle_raw, str) and cycle_raw.strip():
        return cycle_raw.strip()
    return None


def _build_manifest_sections(
    *,
    store: UriStore,
    ap: ArtifactPaths,
    artifact_root_uri: str,
    cycle: str,
    fhours: Iterable[str],
    scalar_variables: Iterable[str],
    vector_variables: Iterable[str],
    scalar_variables_cfg: Mapping[str, Mapping[str, Any]] | None,
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, dict[str, Any]]],
]:
    if not isinstance(scalar_variables_cfg, Mapping):
        raise SystemExit("scalar_variables_cfg is required to build scalar manifest")

    grids: dict[str, dict[str, Any]] = {}
    encodings: dict[str, dict[str, Any]] = {}
    variable_meta: dict[str, dict[str, Any]] = {}
    frames: dict[str, dict[str, dict[str, Any]]] = {str(fhour): {} for fhour in fhours}

    for variable in scalar_variables:
        layer_cfg = scalar_variables_cfg.get(variable)
        if not isinstance(layer_cfg, Mapping):
            raise SystemExit(f"Missing layer config for variable {variable!r}")

        scalar_cfg = layer_cfg.get("scalar_encoding")
        if not isinstance(scalar_cfg, Mapping):
            raise SystemExit(f"Layer {variable!r} missing required scalar_encoding object")

        encoding_id = _as_str(scalar_cfg.get("encoding_id"), field=f"{variable}.scalar_encoding.encoding_id")
        dtype = _as_str(scalar_cfg.get("dtype"), field=f"{variable}.scalar_encoding.dtype")
        byte_order = _as_str(scalar_cfg.get("byte_order"), field=f"{variable}.scalar_encoding.byte_order")
        scale = _as_float(scalar_cfg.get("scale"), field=f"{variable}.scalar_encoding.scale")
        offset = _as_float(scalar_cfg.get("offset"), field=f"{variable}.scalar_encoding.offset")
        nodata = _as_int(scalar_cfg.get("nodata"), field=f"{variable}.scalar_encoding.nodata")

        encoding_entry = {
            "format": WEATHER_SCALAR_FORMAT,
            "dtype": dtype,
            "byte_order": byte_order,
            "scale": scale,
            "offset": offset,
            "nodata": nodata,
            "decode_formula": WEATHER_SCALAR_DECODE_FORMULA,
        }
        prev_encoding = encodings.get(encoding_id)
        if prev_encoding is None:
            encodings[encoding_id] = encoding_entry
        elif prev_encoding != encoding_entry:
            raise SystemExit(
                f"Conflicting scalar encoding definitions for encoding_id={encoding_id!r}"
            )

        variable_meta[variable] = {
            "kind": "scalar",
            "units": str(layer_cfg.get("units", "")).strip(),
            "parameter": str(layer_cfg.get("parameter", "")).strip(),
            "level": str(layer_cfg.get("level", "")).strip(),
            "valid_min": _as_float(layer_cfg.get("scale_min"), field=f"{variable}.scale_min"),
            "valid_max": _as_float(layer_cfg.get("scale_max"), field=f"{variable}.scale_max"),
            "grid_id": WEATHER_SCALAR_GRID_ID,
            "encoding_id": encoding_id,
        }

        for fhour in fhours:
            marker_uri = ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=variable)
            marker = _read_json(store=store, uri=marker_uri)
            scalar = marker.get("scalar")
            if not isinstance(scalar, Mapping):
                raise SystemExit(
                    f"Success marker missing scalar payload metadata: {marker_uri}"
                )

            payload_uri = _as_str(scalar.get("payload_uri"), field=f"{marker_uri}.scalar.payload_uri")
            byte_length = _as_int(scalar.get("byte_length"), field=f"{marker_uri}.scalar.byte_length")
            sha256 = _as_str(scalar.get("sha256"), field=f"{marker_uri}.scalar.sha256")
            marker_encoding_id_raw = scalar.get("encoding_id")
            if marker_encoding_id_raw is not None:
                marker_encoding_id = _as_str(
                    marker_encoding_id_raw,
                    field=f"{marker_uri}.scalar.encoding_id",
                )
                if marker_encoding_id != encoding_id:
                    raise SystemExit(
                        f"Scalar encoding_id mismatch in marker {marker_uri}: "
                        f"marker={marker_encoding_id!r} config={encoding_id!r}"
                    )

            marker_format_raw = scalar.get("format")
            if marker_format_raw is not None:
                marker_format = _as_str(marker_format_raw, field=f"{marker_uri}.scalar.format")
                if marker_format != WEATHER_SCALAR_FORMAT:
                    raise SystemExit(
                        f"Scalar format mismatch in marker {marker_uri}: "
                        f"marker={marker_format!r} expected={WEATHER_SCALAR_FORMAT!r}"
                    )
            if byte_length <= 0:
                raise SystemExit(f"Invalid scalar.byte_length in marker {marker_uri}: {byte_length}")

            grid = _normalize_grid(scalar.get("grid"))
            _register_grid(
                grids=grids,
                grid_id=WEATHER_SCALAR_GRID_ID,
                grid=grid,
                context=marker_uri,
            )

            frames[str(fhour)][str(variable)] = {
                "path": _relative_artifact_path(artifact_root_uri=artifact_root_uri, uri=payload_uri),
                "byte_length": byte_length,
                "sha256": sha256,
            }

    if tuple(scalar_variables) and WEATHER_SCALAR_GRID_ID not in grids:
        raise SystemExit("No scalar grid metadata found while building manifest")

    for variable in vector_variables:
        first_vector_meta: dict[str, Any] | None = None
        for fhour in fhours:
            marker_uri = ap.success_marker_uri_parts(cycle=cycle, fhour=fhour, layer=variable)
            marker = _read_json(store=store, uri=marker_uri)
            vector = marker.get("vector")
            if not isinstance(vector, Mapping):
                raise SystemExit(f"Success marker missing vector payload metadata: {marker_uri}")

            payload_uri = _as_str(vector.get("payload_uri"), field=f"{marker_uri}.vector.payload_uri")
            byte_length = _as_int(vector.get("byte_length"), field=f"{marker_uri}.vector.byte_length")
            sha256 = _as_str(vector.get("sha256"), field=f"{marker_uri}.vector.sha256")
            if byte_length <= 0:
                raise SystemExit(f"Invalid vector.byte_length in marker {marker_uri}: {byte_length}")

            encoding_id = _as_str(vector.get("encoding_id"), field=f"{marker_uri}.vector.encoding_id")
            format_ = _as_str(vector.get("format"), field=f"{marker_uri}.vector.format")
            dtype = _as_str(vector.get("dtype"), field=f"{marker_uri}.vector.dtype")
            byte_order = _as_str(vector.get("byte_order"), field=f"{marker_uri}.vector.byte_order")
            scale = _as_float(vector.get("scale"), field=f"{marker_uri}.vector.scale")
            offset = _as_float(vector.get("offset"), field=f"{marker_uri}.vector.offset")
            decode_formula = _as_str(vector.get("decode_formula"), field=f"{marker_uri}.vector.decode_formula")
            components = _as_str_list(vector.get("components"), field=f"{marker_uri}.vector.components")
            component_count = _as_int(vector.get("component_count"), field=f"{marker_uri}.vector.component_count")
            component_order = _as_str(vector.get("component_order"), field=f"{marker_uri}.vector.component_order")
            if component_count != len(components):
                raise SystemExit(
                    f"vector.component_count mismatch in marker {marker_uri}: "
                    f"count={component_count} len(components)={len(components)}"
                )

            grid_id = _as_str(vector.get("grid_id"), field=f"{marker_uri}.vector.grid_id")
            grid = _normalize_grid(vector.get("grid"))
            _register_grid(grids=grids, grid_id=grid_id, grid=grid, context=marker_uri)

            vector_meta = {
                "encoding_id": encoding_id,
                "format": format_,
                "dtype": dtype,
                "byte_order": byte_order,
                "scale": scale,
                "offset": offset,
                "decode_formula": decode_formula,
                "components": components,
                "component_count": component_count,
                "component_order": component_order,
                "units": _as_str(vector.get("units"), field=f"{marker_uri}.vector.units"),
                "parameter": _as_str(vector.get("parameter"), field=f"{marker_uri}.vector.parameter"),
                "level": _as_str(vector.get("level"), field=f"{marker_uri}.vector.level"),
                "valid_min": _as_float(vector.get("valid_min"), field=f"{marker_uri}.vector.valid_min"),
                "valid_max": _as_float(vector.get("valid_max"), field=f"{marker_uri}.vector.valid_max"),
                "grid_id": grid_id,
            }
            if first_vector_meta is None:
                first_vector_meta = vector_meta
            elif first_vector_meta != vector_meta:
                raise SystemExit(
                    f"Vector metadata mismatch across forecast hours for variable={variable!r}; "
                    f"first={first_vector_meta!r} current={vector_meta!r} marker={marker_uri}"
                )

            frames[str(fhour)][str(variable)] = {
                "path": _relative_artifact_path(artifact_root_uri=artifact_root_uri, uri=payload_uri),
                "byte_length": byte_length,
                "sha256": sha256,
            }

        if first_vector_meta is None:
            raise SystemExit(f"No vector metadata found for variable={variable!r}")

        encoding_id = str(first_vector_meta["encoding_id"])
        encoding_entry = {
            "format": first_vector_meta["format"],
            "dtype": first_vector_meta["dtype"],
            "byte_order": first_vector_meta["byte_order"],
            "scale": first_vector_meta["scale"],
            "offset": first_vector_meta["offset"],
            "decode_formula": first_vector_meta["decode_formula"],
            "components": first_vector_meta["components"],
            "component_count": first_vector_meta["component_count"],
            "component_order": first_vector_meta["component_order"],
        }
        previous_encoding = encodings.get(encoding_id)
        if previous_encoding is None:
            encodings[encoding_id] = encoding_entry
        elif previous_encoding != encoding_entry:
            raise SystemExit(
                f"Conflicting vector encoding definitions for encoding_id={encoding_id!r}"
            )

        variable_meta[variable] = {
            "kind": "vector",
            "units": first_vector_meta["units"],
            "parameter": first_vector_meta["parameter"],
            "level": first_vector_meta["level"],
            "valid_min": first_vector_meta["valid_min"],
            "valid_max": first_vector_meta["valid_max"],
            "grid_id": first_vector_meta["grid_id"],
            "encoding_id": encoding_id,
        }

    return grids, encodings, variable_meta, frames


@dataclass(frozen=True)
class PublishResult:
    ready: bool
    already_published: bool
    missing_markers: tuple[str, ...] = ()


def run_publish(
    *,
    ctx: ExecutionContext,
    cycle: str,
    scalar_variables: Iterable[str],
    vector_variables: Iterable[str] = (),
    scalar_variables_cfg: Mapping[str, Mapping[str, Any]] | None = None,
) -> PublishResult:
    fhours = tuple(ctx.forecast_hours or ())
    scalar_variables = tuple(scalar_variables)
    vector_variables = tuple(vector_variables)

    if not fhours:
        print("Publish not ready: ctx.forecast_hours is empty")
        return PublishResult(ready=False, already_published=False)

    if not scalar_variables and not vector_variables:
        print("Publish not ready: scalar_variables and vector_variables are empty")
        return PublishResult(ready=False, already_published=False)

    store = make_store()
    ap = ArtifactPaths(ctx.artifact_root_uri)

    # Check for expected success markers
    existing = _list_success_markers(store=store, ap=ap, cycle=cycle)
    expected = _expected_success_markers(
        ap=ap,
        cycle=cycle,
        fhours=fhours,
        scalar_variables=scalar_variables,
        vector_variables=vector_variables,
    )
    missing = sorted(expected - existing)

    # If any markers are missing, exit not-ready
    if missing:
        print(f"Publish not ready: missing {len(missing)} success markers")
        for m in missing[:10]:
            print(f"missing: {m}")
        if len(missing) > 10:
            print(f"... and {len(missing) - 10} more")
        return PublishResult(ready=False, already_published=False, missing_markers=tuple(missing))

    grids, encodings, variable_meta, frames = _build_manifest_sections(
        store=store,
        ap=ap,
        artifact_root_uri=ctx.artifact_root_uri,
        cycle=cycle,
        fhours=fhours,
        scalar_variables=scalar_variables,
        vector_variables=vector_variables,
        scalar_variables_cfg=scalar_variables_cfg,
    )

    generated_at = _utc_now_iso()
    revision = _compute_manifest_revision(
        cycle=cycle,
        hours=fhours,
        scalar_variables=scalar_variables,
        vector_variables=vector_variables,
        grids=grids,
        encodings=encodings,
        variable_meta=variable_meta,
        frames=frames,
    )

    cycle_manifest_uri = ap.manifest_cycle_uri(cycle=cycle)
    manifest_obj = {
        "version": MANIFEST_VERSION,
        "contract": FORECAST_BINARY_CONTRACT,
        "cycle": cycle,
        "generated_at": generated_at,
        "revision": revision,
        "forecast_hours": list(fhours),
        "scalar_variables": list(scalar_variables),
        "vector_variables": list(vector_variables),
        "grids": grids,
        "encodings": encodings,
        "variable_meta": variable_meta,
        "frames": frames,
    }

    # All markers present; check published marker
    published_uri = ap.published_marker_uri(cycle=cycle)
    already_published = False
    if store.exists(uri=published_uri):
        prev = _read_json(store=store, uri=published_uri)
        prev_rev = str(prev.get("revision", "")).strip()

        if (
            prev_rev == revision
            and store.exists(uri=cycle_manifest_uri)
        ):
            already_published = True
            print(f"Already published (same revisions): {published_uri}")
        else:
            print(
                "Publish marker exists but revision differs; republishing.\n"
                f"  cycle={cycle}\n"
                f"  prev_revision={prev_rev!r}\n"
                f"  new_revision={revision!r}\n"
                f"  marker={published_uri}"
            )

    if not already_published:
        _write_json(
            store=store,
            uri=cycle_manifest_uri,
            obj=manifest_obj,
        )

    # Promote latest.json to the newest published cycle only.
    latest_manifest_uri = ap.manifest_latest_uri()
    current_latest_cycle = _read_latest_cycle(store=store, latest_manifest_uri=latest_manifest_uri)
    promote_latest = current_latest_cycle is None or cycle >= current_latest_cycle
    if promote_latest:
        _write_json(
            store=store,
            uri=latest_manifest_uri,
            obj=manifest_obj,
        )
    else:
        print(
            "Skipping latest manifest promotion for older cycle.\n"
            f"  cycle={cycle}\n"
            f"  current_latest_cycle={current_latest_cycle}"
        )

    if not already_published:
        # Write publish marker last (signals publish completion).
        _write_json(
            store=store,
            uri=published_uri,
            obj={
                "cycle": cycle,
                "generated_at": generated_at,
                "revision": revision,
                "manifest_uri": cycle_manifest_uri,
            },
        )

    print(f"Published: {cycle_manifest_uri}")
    return PublishResult(ready=True, already_published=already_published)
