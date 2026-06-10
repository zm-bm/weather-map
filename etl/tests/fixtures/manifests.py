from __future__ import annotations

from datetime import timedelta
from typing import Iterable

from weather_etl.config.encoding import LINEAR_DECODE_FORMULA, is_linear_encoding_format, payload_suffix_for_dtype
from weather_etl.config.pipeline import ArtifactSpec, DatasetConfig
from weather_etl.core.cycles import cycle_datetime
from weather_etl.core.frames import parse_lead_hour_frame_id
from weather_etl.core.timestamps import isoformat_utc
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.state.manifest.constants import DATA_BINARY_CONTRACT, MANIFEST_SCHEMA, MANIFEST_SCHEMA_VERSION
from weather_etl.state.manifest.schema import parse_cycle_manifest

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.artifact_specs import artifact_spec
from tests.fixtures.artifacts import DEFAULT_RUN_ID


def manifest_artifact_entry(
    artifact_id: str,
    *,
    artifact: ArtifactSpec | None = None,
    dataset_id: str = "gfs",
    cycle: str = "2026041100",
    run_id: str = DEFAULT_RUN_ID,
    frame_ids: Iterable[str] = ("000",),
    grid_id: str = "gfs_0p25_global",
    byte_length: int | None = None,
    parameter: str = "tmp",
) -> dict:
    artifact = artifact or artifact_spec(
        artifact_id,
        {
            **minimal_artifact_config(),
            "parameter": parameter,
        },
    )
    dtype_suffix = payload_suffix_for_dtype(artifact.encoding.dtype)
    frame_tuple = tuple(frame_ids)
    return {
        "id": artifact_id,
        "kind": artifact.kind,
        "units": artifact.units,
        "parameter": artifact.parameter,
        "level": artifact.level,
        "components": list(artifact.component_ids),
        "grid": _manifest_grid(grid_id=grid_id),
        "encoding": _manifest_encoding(artifact),
        "payload_file": f"{artifact_id}.{dtype_suffix}.bin",
        "frames": {
            frame_id: {
                "path": (
                    f"runs/{dataset_id}/{cycle}/{run_id}/payloads/"
                    f"{frame_id}/{artifact_id}.{dtype_suffix}.bin"
                ),
                "byte_length": byte_length or len(artifact.component_ids) * 4,
                "sha256": "a" * 64,
            }
            for frame_id in frame_tuple
        },
    }


def cycle_manifest_dict(
    dataset: DatasetConfig,
    *,
    cycle: str,
    artifact_ids: Iterable[str],
    frames: Iterable[str] = ("000", "003"),
    run_id: str = DEFAULT_RUN_ID,
    generated_at: str = "2026-05-16T00:00:00Z",
    revision: str | None = None,
) -> dict:
    frame_tuple = tuple(frames)
    return {
        "schema": MANIFEST_SCHEMA,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "payload_contract": DATA_BINARY_CONTRACT,
        "dataset": {
            "id": dataset.id,
            "label": dataset.label,
        },
        "run": {
            "cycle": cycle,
            "run_id": run_id,
            "payload_root": f"runs/{dataset.id}/{cycle}/{run_id}/payloads",
            "generated_at": generated_at,
            "revision": revision or f"{dataset.id}-{cycle}-revision",
        },
        "frames": [
            _manifest_frame_entry(cycle=cycle, frame_id=frame_id)
            for frame_id in frame_tuple
        ],
        "artifacts": {
            artifact_id: manifest_artifact_entry(
                artifact_id,
                artifact=dataset.artifacts[artifact_id],
                dataset_id=dataset.id,
                cycle=cycle,
                run_id=run_id,
                frame_ids=frame_tuple,
                grid_id=dataset.source.grid_id,
            )
            for artifact_id in artifact_ids
        },
    }


def write_latest_manifest(repo: ArtifactRepository, *, dataset_id: str, manifest: dict) -> None:
    repo.write_latest_manifest(dataset_id=dataset_id, manifest=parse_cycle_manifest(manifest))


def _manifest_frame_entry(*, cycle: str, frame_id: str) -> dict:
    lead_hours = parse_lead_hour_frame_id(frame_id)
    return {
        "id": frame_id,
        "lead_hours": lead_hours,
        "valid_at": isoformat_utc(cycle_datetime(cycle) + timedelta(hours=lead_hours)),
    }


def _manifest_grid(*, grid_id: str) -> dict:
    return {
        "id": grid_id,
        "crs": "EPSG:4326",
        "nx": 2,
        "ny": 2,
        "lon0": 0.0,
        "lat0": 0.0,
        "dx": 1.0,
        "dy": 1.0,
        "origin": "cell_center",
        "layout": "row_major",
        "x_wrap": "repeat",
        "y_mode": "clamp",
    }


def _manifest_encoding(artifact: ArtifactSpec) -> dict:
    encoding = artifact.encoding
    entry = {
        "id": encoding.id,
        "format": encoding.format,
        "dtype": encoding.dtype,
        "byte_order": encoding.byte_order,
    }
    if encoding.nodata is not None:
        entry["nodata"] = encoding.nodata
    if is_linear_encoding_format(encoding.format):
        entry["scale"] = encoding.scale
        entry["offset"] = encoding.offset
        entry["decode_formula"] = LINEAR_DECODE_FORMULA
    if encoding.finite_value_range is not None:
        entry["finite_value_range"] = {
            "min": encoding.finite_value_range.min,
            "max": encoding.finite_value_range.max,
        }
    return entry
