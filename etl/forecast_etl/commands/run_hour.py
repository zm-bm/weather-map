"""Run one forecast hour through source acquisition and artifact generation."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Iterable, Mapping

from ..artifacts.markers_schema import build_artifact_marker_payload
from ..artifacts.paths import WorkItem
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec, ModelConfig
from ..encoding.artifact_payload import encode_artifact_payload
from ..extract.artifact_bands import extract_artifact_bands
from ..extract.grib import grid_meta_from_grib
from ..extract.grid_transforms import apply_artifact_grid_transform
from ..proc import RunFn, make_runner
from ..runtime import ExecutionContext
from ..source_adapters import acquire_prepared_source
from ..storage.base import UriStore
from ..storage.routing import make_store


def run_process_hour(
    *,
    ctx: ExecutionContext,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri: str | None,
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    store: UriStore,
    artifact_repo: ArtifactRepository,
    run: RunFn,
) -> None:
    """Run all configured artifacts for one (cycle, fhour)."""

    artifact_ids = tuple(artifact_ids or ())

    if not artifact_ids:
        raise SystemExit("No workload.artifacts configured for process-hour")

    with tempfile.TemporaryDirectory(prefix="forecast-work-hour-") as td:
        workdir = Path(td)
        source = acquire_prepared_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri,
            artifact_ids=artifact_ids,
            workdir=workdir,
            store=store,
            run=run,
        )
        grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=run)

        artifact_done = 0
        for artifact_id in artifact_ids:
            artifact = artifact_specs.get(artifact_id)
            if artifact is None:
                raise SystemExit(f"Unknown artifact in workload.artifacts: {artifact_id}")

            item = WorkItem(
                model_id=ctx.model_id,
                cycle=cycle,
                fhour=fhour,
                source_uri=source.uri,
                artifact_id=str(artifact_id),
            )
            bands = extract_artifact_bands(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=workdir,
                run=run,
                fhour=fhour,
            )
            transformed = apply_artifact_grid_transform(
                artifact=artifact,
                grid_id=source.grid_id,
                grid=grid,
                bands=bands,
            )
            payload = encode_artifact_payload(artifact=artifact, grid=transformed.grid, bands=transformed.bands)
            payload_uri = artifact_repo.write_field_payload(item=item, dtype=artifact.encoding.dtype, payload=payload)
            artifact_marker_payload = build_artifact_marker_payload(
                artifact=artifact,
                payload_uri=payload_uri,
                payload=payload,
                grid_id=transformed.grid_id,
                grid=transformed.grid,
            )
            artifact_repo.write_success_marker(item=item, artifact=artifact_marker_payload)
            artifact_done += 1

    print(
        f"Done. Processed fhour bundle cycle={cycle} fhour={fhour}: "
        f"model={ctx.model_id} artifacts={artifact_done}",
        flush=True,
    )


def run_hour(
    *,
    model: ModelConfig,
    ctx: ExecutionContext,
    cycle: str,
    fhour: str,
    source_uri: str | None,
    artifact_ids: Iterable[str] | None = None,
    store: UriStore | None = None,
    run: RunFn | None = None,
) -> None:
    """Process one forecast hour."""

    resolved_store = store if store is not None else make_store()
    artifact_repo = ArtifactRepository.for_root(store=resolved_store, artifact_root_uri=ctx.artifact_root_uri)
    resolved_run = run if run is not None else make_runner()
    run_process_hour(
        ctx=ctx,
        model=model,
        cycle=cycle,
        fhour=fhour,
        source_uri=source_uri,
        artifact_ids=tuple(artifact_ids or model.workload.artifacts),
        artifact_specs=model.artifacts,
        store=resolved_store,
        artifact_repo=artifact_repo,
        run=resolved_run,
    )
