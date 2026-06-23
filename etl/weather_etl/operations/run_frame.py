"""Operation for processing one dataset frame."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterable

from ..config.pipeline import DatasetConfig
from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..environment.context import ExecutionContext, execution_context
from ..processing.artifact import process_artifact
from ..processing.grib import grid_meta_from_grib
from ..processing.proc import RunFn, make_runner
from ..sources.registry import acquire_prepared_source
from ..state.artifacts.identity import ArtifactWorkItem
from ..state.artifacts.markers_schema import build_artifact_marker_payload
from ..state.artifacts.repository import ArtifactRepository
from ..state.runs.ids import parse_run_id
from ..state.runs.metadata import RunSnapshot
from ..storage.base import UriStore
from ..storage.routing import make_store
from .workload_selection import WorkloadSelectionError, selected_workload_artifact_ids


def run_frame(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str,
    frame_id: str,
    source_uri: str | None,
    selected_artifacts: Iterable[str] | None,
) -> None:
    """Resolve one frame command and run the frame job."""

    parse_cycle(cycle)
    resolved_run_id = parse_run_id(run_id)
    snapshot = env.ensure_or_load_run_snapshot(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
    )
    dataset = snapshot.dataset(dataset_id)
    try:
        artifact_ids = selected_workload_artifact_ids(dataset, selected_artifacts)
    except WorkloadSelectionError as exc:
        raise SystemExit(str(exc)) from None

    run_frame_job(
        ctx=execution_context(
            dataset_id=dataset.id,
            artifact_root_uri=env.artifact_root_uri,
            frames=dataset.workload.frames,
        ),
        dataset=dataset,
        cycle=cycle,
        run_id=resolved_run_id,
        frame_id=frame_id,
        source_uri=source_uri,
        artifact_ids=artifact_ids,
        store=env.store,
        run_snapshot=snapshot.run_snapshot,
    )


def run_frame_job(
    *,
    ctx: ExecutionContext,
    dataset: DatasetConfig,
    cycle: str,
    run_id: str,
    frame_id: str,
    source_uri: str | None,
    run_snapshot: RunSnapshot,
    artifact_ids: Iterable[str] | None = None,
    store: UriStore | None = None,
    artifact_repo: ArtifactRepository | None = None,
    run: RunFn | None = None,
) -> None:
    """Acquire one prepared source, process selected artifacts, and write markers."""

    if dataset.id != ctx.dataset_id:
        raise SystemExit(f"Frame job dataset mismatch: dataset.id={dataset.id!r} ctx.dataset_id={ctx.dataset_id!r}")

    artifact_ids = tuple(artifact_ids or dataset.workload.artifacts or ())
    metadata = run_snapshot.metadata
    resolved_store = store if store is not None else make_store()
    resolved_repo = artifact_repo or ArtifactRepository.for_root(
        store=resolved_store,
        artifact_root_uri=ctx.artifact_root_uri,
    )
    resolved_run = run if run is not None else make_runner()

    if not artifact_ids:
        raise SystemExit("No workload.artifacts configured for run-frame")

    resolved_repo.ensure_run_snapshot(
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=run_id,
        snapshot=run_snapshot,
    )

    with tempfile.TemporaryDirectory(prefix="weather-etl-frame-") as td:
        workdir = Path(td)
        source = acquire_prepared_source(
            dataset=dataset,
            cycle=cycle,
            frame_id=frame_id,
            source_uri_override=source_uri,
            artifact_ids=artifact_ids,
            workdir=workdir,
            store=resolved_store,
            run=resolved_run,
        )
        grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=resolved_run)

        artifact_done = 0
        for artifact_id in artifact_ids:
            artifact = dataset.artifacts.get(artifact_id)
            if artifact is None:
                raise SystemExit(f"Unknown artifact in workload.artifacts: {artifact_id}")

            item = ArtifactWorkItem(
                dataset_id=ctx.dataset_id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                source_uri=source.uri,
                artifact_id=str(artifact_id),
                code_revision=metadata.code_revision,
                image_identity=metadata.image_identity,
                product_config_digest=metadata.product_config_digest,
            )
            processed = process_artifact(
                artifact=artifact,
                source=source,
                grid=grid,
                frame_id=frame_id,
                workdir=workdir,
                run=resolved_run,
            )
            payload_uri = resolved_repo.write_payload(
                item=item,
                dtype=processed.dtype,
                payload=processed.payload,
            )
            artifact_marker_payload = build_artifact_marker_payload(
                artifact=artifact,
                payload_uri=payload_uri,
                payload=processed.payload,
                grid_id=processed.grid_id,
                grid=processed.grid,
            )
            resolved_repo.write_success_marker(item=item, artifact=artifact_marker_payload)
            artifact_done += 1

    print(
        f"Done. Processed frame bundle cycle={cycle} run_id={run_id} frame_id={frame_id}: "
        f"dataset_id={ctx.dataset_id} artifacts={artifact_done}",
        flush=True,
    )
