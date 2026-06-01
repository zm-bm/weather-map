"""Helpers for immutable per-run config/catalog snapshots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .artifacts.repository import ArtifactRepository
from .catalog import load_forecast_catalog
from .config.load import LoadedPipelineConfig, load_pipeline_config_document
from .run_ids import validate_run_id
from .run_metadata import RunSnapshot, json_document_digest, run_metadata_from_env
from .storage.base import UriStore


@dataclass(frozen=True)
class LoadedRunSnapshot:
    """Resolved run snapshot documents and their canonical run URIs."""

    run_id: str
    config_digest: str
    pipeline_config_uri: str
    forecast_catalog_uri: str
    loaded_config: LoadedPipelineConfig
    forecast_catalog: dict[str, Any]


def select_run_id_for_cycle(
    *,
    artifact_repo: ArtifactRepository,
    model_id: str,
    cycle: str,
    required_run_id: str | None,
) -> tuple[str | None, list[str]]:
    """Select the only publishable run id unless an explicit run id is required."""

    if required_run_id is not None:
        return validate_run_id(required_run_id), []

    run_ids = artifact_repo.list_run_ids(model_id=model_id, cycle=cycle)
    if not run_ids:
        return None, [f"no runs found for model={model_id!r} cycle={cycle!r}"]
    if len(run_ids) > 1:
        return None, [f"multiple runs found for model={model_id!r} cycle={cycle!r}: {list(run_ids)!r}"]
    return run_ids[0], []


def ensure_run_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    model_id: str,
    cycle: str,
    run_id: str,
    pipeline_config_uri: str,
    pipeline_config_overlay_uri: str | None = None,
    forecast_catalog_uri: str,
) -> LoadedRunSnapshot:
    """Create or verify one run snapshot from source config/catalog URIs."""

    loaded = load_pipeline_config_document(
        pipeline_config_uri,
        overlay_uri=pipeline_config_overlay_uri,
        store=store,
    )
    loaded.config.model(model_id)
    catalog = load_forecast_catalog(catalog_uri=forecast_catalog_uri, store=store)
    config_digest = json_document_digest(loaded.raw)
    snapshot = RunSnapshot(
        metadata=run_metadata_from_env(config_digest=config_digest),
        pipeline_config=loaded.raw,
        forecast_catalog=catalog,
    )
    artifact_repo.ensure_run_snapshot(
        model_id=model_id,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return load_run_snapshot(
        artifact_repo=artifact_repo,
        store=store,
        model_id=model_id,
        cycle=cycle,
        run_id=run_id,
    )


def ensure_or_load_run_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    model_id: str,
    cycle: str,
    run_id: str,
    pipeline_config_uri: str,
    pipeline_config_overlay_uri: str | None = None,
    forecast_catalog_uri: str,
) -> LoadedRunSnapshot:
    """Load an existing run snapshot, or create it from source config/catalog."""

    if _run_metadata_exists(artifact_repo=artifact_repo, model_id=model_id, cycle=cycle, run_id=run_id):
        return load_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
        )

    try:
        return ensure_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
            pipeline_config_uri=pipeline_config_uri,
            pipeline_config_overlay_uri=pipeline_config_overlay_uri,
            forecast_catalog_uri=forecast_catalog_uri,
        )
    except SystemExit:
        if _run_metadata_exists(artifact_repo=artifact_repo, model_id=model_id, cycle=cycle, run_id=run_id):
            return load_run_snapshot(
                artifact_repo=artifact_repo,
                store=store,
                model_id=model_id,
                cycle=cycle,
                run_id=run_id,
            )
        raise


def load_run_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    model_id: str,
    cycle: str,
    run_id: str,
) -> LoadedRunSnapshot:
    """Load and validate the pinned config/catalog for one existing run."""

    run_id = validate_run_id(run_id)
    run_uri = artifact_repo.paths.run_metadata_uri(model_id=model_id, cycle=cycle, run_id=run_id)
    try:
        run_doc = artifact_repo.read_json_uri(run_uri)
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"Missing run metadata snapshot: {run_uri}") from exc

    _validate_run_doc(run_doc=run_doc, model_id=model_id, cycle=cycle, run_id=run_id, uri=run_uri)
    pipeline_config_uri = artifact_repo.paths.run_pipeline_config_uri(model_id=model_id, cycle=cycle, run_id=run_id)
    forecast_catalog_uri = artifact_repo.paths.run_forecast_catalog_uri(model_id=model_id, cycle=cycle, run_id=run_id)
    loaded = load_pipeline_config_document(pipeline_config_uri, store=store)
    catalog = load_forecast_catalog(catalog_uri=forecast_catalog_uri, store=store)
    config_digest = json_document_digest(loaded.raw)
    expected_digest = run_doc.get("configDigest")
    if expected_digest != config_digest:
        raise SystemExit(
            "Run snapshot config digest mismatch:\n"
            f"  run={run_uri}\n"
            f"  run.json={expected_digest!r}\n"
            f"  config={config_digest!r}"
        )
    return LoadedRunSnapshot(
        run_id=run_id,
        config_digest=config_digest,
        pipeline_config_uri=pipeline_config_uri,
        forecast_catalog_uri=forecast_catalog_uri,
        loaded_config=loaded,
        forecast_catalog=catalog,
    )


def _run_metadata_exists(*, artifact_repo: ArtifactRepository, model_id: str, cycle: str, run_id: str) -> bool:
    return artifact_repo.store.exists(uri=artifact_repo.paths.run_metadata_uri(model_id=model_id, cycle=cycle, run_id=run_id))


def _validate_run_doc(
    *,
    run_doc: dict[str, Any],
    model_id: str,
    cycle: str,
    run_id: str,
    uri: str,
) -> None:
    expected = {
        "model": model_id,
        "cycle": cycle,
        "runId": run_id,
    }
    for key, expected_value in expected.items():
        if run_doc.get(key) != expected_value:
            raise SystemExit(
                "Run metadata snapshot identity mismatch:\n"
                f"  run={uri}\n"
                f"  field={key}\n"
                f"  expected={expected_value!r}\n"
                f"  found={run_doc.get(key)!r}"
            )
