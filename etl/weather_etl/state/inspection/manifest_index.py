"""Read-only manifest index inspection."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ...config.product import LoadedProductConfig
from ..artifacts.repository import ArtifactRepository
from ..manifest.constants import MANIFEST_INDEX_SCHEMA, MANIFEST_INDEX_SCHEMA_VERSION
from ..manifest.index import build_index

INDEX_SUMMARY_SCHEMA = "weather-map.manifest-index-summary"
INDEX_SUMMARY_SCHEMA_VERSION = 2


def summarize_index(
    *,
    artifact_repo: ArtifactRepository,
    product_config: LoadedProductConfig | None = None,
) -> dict[str, Any]:
    """Return a lightweight summary of the public manifest index."""

    uri = artifact_repo.paths.manifest_index_uri()
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.manifest_index_exists():
        return _base_index_summary(status="missing", path=path, diagnostics=["manifest index is missing"])

    try:
        manifest = artifact_repo.read_manifest_index()
    except (FileNotFoundError, ValueError, SystemExit) as exc:
        return _base_index_summary(status="malformed", path=path, diagnostics=[f"unable to read JSON: {exc}"])

    if not isinstance(manifest, Mapping):
        return _base_index_summary(status="malformed", path=path, diagnostics=["manifest index must be an object"])

    diagnostics = _index_schema_diagnostics(manifest)
    stale_diagnostics = (
        _product_index_diagnostics(
            artifact_repo=artifact_repo,
            manifest=manifest,
            product_config=product_config,
        )
        if product_config is not None and not diagnostics
        else []
    )
    status = "malformed" if diagnostics else "stale" if stale_diagnostics else "valid"
    datasets = manifest.get("datasets")
    layers = manifest.get("layers")
    dataset_summaries = _index_dataset_summaries(datasets if isinstance(datasets, Mapping) else {})

    return {
        **_base_index_summary(status=status, path=path, diagnostics=[*diagnostics, *stale_diagnostics]),
        "generated_at": manifest.get("generated_at"),
        "catalog_version": manifest.get("catalog_version"),
        "payload_contract": manifest.get("payload_contract"),
        "dataset_count": len(dataset_summaries),
        "latest_dataset_count": sum(1 for dataset in dataset_summaries.values() if dataset["latest_present"]),
        "layer_count": len(layers) if isinstance(layers, Mapping) else None,
        "datasets": dataset_summaries,
    }


def _base_index_summary(*, status: str, path: str, diagnostics: list[str]) -> dict[str, Any]:
    return {
        "schema": INDEX_SUMMARY_SCHEMA,
        "schema_version": INDEX_SUMMARY_SCHEMA_VERSION,
        "path": path,
        "status": status,
        "diagnostics": diagnostics,
    }


def _index_schema_diagnostics(manifest: Mapping[str, Any]) -> list[str]:
    diagnostics: list[str] = []
    if manifest.get("schema") != MANIFEST_INDEX_SCHEMA:
        diagnostics.append(
            f"schema mismatch: expected={MANIFEST_INDEX_SCHEMA!r} found={manifest.get('schema')!r}"
        )
    if manifest.get("schema_version") != MANIFEST_INDEX_SCHEMA_VERSION:
        diagnostics.append(
            "schema_version mismatch: "
            f"expected={MANIFEST_INDEX_SCHEMA_VERSION!r} found={manifest.get('schema_version')!r}"
        )
    if not isinstance(manifest.get("datasets"), Mapping):
        diagnostics.append("datasets must be an object")
    if not isinstance(manifest.get("layers"), Mapping):
        diagnostics.append("layers must be an object")
    return diagnostics


def _product_index_diagnostics(
    *,
    artifact_repo: ArtifactRepository,
    manifest: Mapping[str, Any],
    product_config: LoadedProductConfig,
) -> list[str]:
    try:
        expected = build_index(
            product_config=product_config,
            artifact_repo=artifact_repo,
            generated_at="inspection-generated-at-ignored",
            strict_dataset_ids=tuple(product_config.pipeline_config.datasets),
        )
    except (ValueError, SystemExit) as exc:
        return [f"unable to build expected manifest index: {exc}"]

    if _index_without_generated_at(manifest) != _index_without_generated_at(expected):
        return ["manifest index does not match current product config and latest manifests"]
    return []


def _index_without_generated_at(index: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in index.items() if key != "generated_at"}


def _index_dataset_summaries(datasets: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    for dataset_id, dataset in datasets.items():
        if not isinstance(dataset, Mapping):
            summaries[str(dataset_id)] = {
                "label": None,
                "latest_present": False,
                "latest_run_id": None,
                "latest_cycle": None,
            }
            continue
        latest = dataset.get("latest")
        run = latest.get("run") if isinstance(latest, Mapping) else None
        latest_run_id = run["run_id"] if isinstance(run, Mapping) and "run_id" in run else None
        latest_cycle = run["cycle"] if isinstance(run, Mapping) and "cycle" in run else None
        summaries[str(dataset_id)] = {
            "label": dataset.get("label"),
            "latest_present": isinstance(latest, Mapping),
            "latest_run_id": latest_run_id,
            "latest_cycle": latest_cycle,
        }
    return summaries
