"""Read-only summaries of the frontend data manifest."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..artifacts.repository import ArtifactRepository
from ..manifest.data_manifest_contract import DATA_MANIFEST_SCHEMA, DATA_MANIFEST_SCHEMA_VERSION

DATA_MANIFEST_SUMMARY_SCHEMA = "weather-map.data-manifest-summary"
DATA_MANIFEST_SUMMARY_SCHEMA_VERSION = 1


def data_manifest_summary(*, artifact_repo: ArtifactRepository) -> dict[str, Any]:
    """Return a lightweight summary of the public data manifest."""

    uri = artifact_repo.paths.data_manifest_uri()
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.data_manifest_exists():
        return _base_summary(status="missing", path=path, diagnostics=["data manifest is missing"])

    try:
        manifest = artifact_repo.read_data_manifest()
    except (Exception, SystemExit) as exc:
        return _base_summary(status="malformed", path=path, diagnostics=[f"unable to read JSON: {exc}"])

    if not isinstance(manifest, Mapping):
        return _base_summary(status="malformed", path=path, diagnostics=["data manifest must be an object"])

    diagnostics = _schema_diagnostics(manifest)
    status = "valid" if not diagnostics else "malformed"
    datasets = manifest.get("datasets")
    layers = manifest.get("layers")
    dataset_summaries = _dataset_summaries(datasets if isinstance(datasets, Mapping) else {})

    return {
        **_base_summary(status=status, path=path, diagnostics=diagnostics),
        "generated_at": manifest.get("generated_at"),
        "catalog_version": manifest.get("catalog_version"),
        "payload_contract": manifest.get("payload_contract"),
        "dataset_count": len(dataset_summaries),
        "latest_dataset_count": sum(1 for dataset in dataset_summaries.values() if dataset["latest_present"]),
        "layer_count": len(layers) if isinstance(layers, Mapping) else None,
        "datasets": dataset_summaries,
    }


def _base_summary(*, status: str, path: str, diagnostics: list[str]) -> dict[str, Any]:
    return {
        "schema": DATA_MANIFEST_SUMMARY_SCHEMA,
        "schema_version": DATA_MANIFEST_SUMMARY_SCHEMA_VERSION,
        "path": path,
        "status": status,
        "diagnostics": diagnostics,
    }


def _schema_diagnostics(manifest: Mapping[str, Any]) -> list[str]:
    diagnostics: list[str] = []
    if manifest.get("schema") != DATA_MANIFEST_SCHEMA:
        diagnostics.append(
            f"schema mismatch: expected={DATA_MANIFEST_SCHEMA!r} found={manifest.get('schema')!r}"
        )
    if manifest.get("schema_version") != DATA_MANIFEST_SCHEMA_VERSION:
        diagnostics.append(
            "schema_version mismatch: "
            f"expected={DATA_MANIFEST_SCHEMA_VERSION!r} found={manifest.get('schema_version')!r}"
        )
    if not isinstance(manifest.get("datasets"), Mapping):
        diagnostics.append("datasets must be an object")
    if not isinstance(manifest.get("layers"), Mapping):
        diagnostics.append("layers must be an object")
    return diagnostics


def _dataset_summaries(datasets: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    for dataset_id, dataset in datasets.items():
        if not isinstance(dataset, Mapping):
            summaries[str(dataset_id)] = {"label": None, "latest_present": False, "latest_run_id": None, "latest_cycle": None}
            continue
        latest = dataset.get("latest")
        run = latest.get("run") if isinstance(latest, Mapping) else None
        summaries[str(dataset_id)] = {
            "label": dataset.get("label"),
            "latest_present": isinstance(latest, Mapping),
            "latest_run_id": run.get("run_id") if isinstance(run, Mapping) else None,
            "latest_cycle": run.get("cycle") if isinstance(run, Mapping) else None,
        }
    return summaries
