from __future__ import annotations

import json
from typing import Any

from forecast_etl.artifacts.markers_schema import build_artifact_marker_payload
from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.encoding.artifact_payload import encode_artifact_payload
from forecast_etl.extract.types import ExtractedBand
from forecast_etl.storage.routing import make_store

from .artifact_configs import artifact_spec, wind_artifact_config
from .artifacts import DEFAULT_CODE_REVISION, DEFAULT_CONFIG_DIGEST, DEFAULT_IMAGE_IDENTITY, DEFAULT_RUN_ID
from .grids import pack_f32


def write_json(uri: str, obj: dict) -> None:
    store = make_store()
    store.write_bytes(uri=uri, data=(json.dumps(obj, sort_keys=True) + "\n").encode("utf-8"))


def write_scalar_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    run_id: str = DEFAULT_RUN_ID,
    frame_id: str,
    artifact_id: str,
    source_values: list[float],
    artifact_config: dict,
    grid_meta: dict[str, Any],
) -> None:
    component_id = str(artifact_config["components"][0]["id"])
    write_artifact_marker(
        store=store,
        ap=ap,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
        artifact_config=artifact_config,
        grid_meta=grid_meta,
        source_values_by_component={component_id: source_values},
    )


def write_vector_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    run_id: str = DEFAULT_RUN_ID,
    frame_id: str,
    artifact_id: str,
    grid_meta: dict[str, Any],
    artifact_config: dict | None = None,
    source_values_by_component: dict[str, list[float]] | None = None,
) -> None:
    cell_count = int(grid_meta["nx"]) * int(grid_meta["ny"])
    if artifact_config is None:
        artifact_config = wind_artifact_config()
        if source_values_by_component is None:
            source_values_by_component = {
                "u": [float(i % 128) * 0.5 for i in range(cell_count)],
                "v": [float((i + 7) % 128) * 0.5 for i in range(cell_count)],
            }
    if source_values_by_component is None:
        source_values_by_component = {
            str(component["id"]): [float((i + component_index) % 128) * 0.5 for i in range(cell_count)]
            for component_index, component in enumerate(artifact_config["components"])
        }
    write_artifact_marker(
        store=store,
        ap=ap,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
        artifact_config=artifact_config,
        grid_meta=grid_meta,
        source_values_by_component=source_values_by_component,
    )


def write_artifact_marker(
    *,
    store,
    ap: ArtifactPaths,
    cycle: str,
    run_id: str = DEFAULT_RUN_ID,
    frame_id: str,
    artifact_id: str,
    artifact_config: dict,
    grid_meta: dict[str, Any],
    source_values_by_component: dict[str, list[float]],
    grid_id: str = "gfs_0p25_global",
) -> None:
    artifact = artifact_spec(artifact_id, artifact_config)
    bands = [
        ExtractedBand(
            component_id=component.id,
            source_f32_bytes=pack_f32(source_values_by_component[component.id], byte_order="little"),
            source_byte_order="little",
        )
        for component in artifact.components
    ]
    payload = encode_artifact_payload(artifact=artifact, grid=grid_meta, bands=bands)
    item = WorkItem(
        dataset_id="gfs",
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        artifact_id=artifact_id,
        source_uri="file:///dev/null",
        code_revision=DEFAULT_CODE_REVISION,
        image_identity=DEFAULT_IMAGE_IDENTITY,
        config_digest=DEFAULT_CONFIG_DIGEST,
    )
    artifacts = ArtifactRepository(store=store, paths=ap)
    payload_uri = artifacts.write_field_payload(item=item, dtype=artifact.encoding.dtype, payload=payload)
    artifact_marker = build_artifact_marker_payload(
        artifact=artifact,
        payload_uri=payload_uri,
        payload=payload,
        grid_id=grid_id,
        grid=grid_meta,
    )
    artifacts.write_success_marker(
        item=item,
        artifact=artifact_marker,
    )
