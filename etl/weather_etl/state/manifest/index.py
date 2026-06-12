"""Frontend manifest index generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Literal, Mapping

from ...config.catalog import (
    CatalogArtifactRequirement,
    CatalogLayerRequirements,
)
from ...config.pipeline import DatasetConfig
from ...config.product import LoadedProductConfig
from ...core.timestamps import utc_now_iso
from ..artifacts.repository import ArtifactRepository
from .constants import DATA_BINARY_CONTRACT, MANIFEST_INDEX_SCHEMA, MANIFEST_INDEX_SCHEMA_VERSION
from .schema import CycleManifest, ManifestArtifact

_AvailabilityState = Literal["available", "unsupported", "temporarily_unavailable"]
_LayerSupport = Literal["native", "frontend-derived", "etl-derived", "unavailable"]


@dataclass(frozen=True)
class _LatestManifestEntry:
    run: dict[str, Any]
    frames: tuple[dict[str, Any], ...]
    artifacts: dict[str, dict[str, Any]]

    @classmethod
    def from_cycle_manifest(cls, manifest: CycleManifest) -> "_LatestManifestEntry":
        frame_ids = tuple(frame.id for frame in manifest.frames)
        return cls(
            run=manifest.run.model_dump(mode="json"),
            frames=tuple(frame.model_dump(mode="json") for frame in manifest.frames),
            artifacts={
                artifact_id: _compact_artifact_entry(
                    artifact_id=artifact_id,
                    artifact=artifact,
                    frame_ids=frame_ids,
                )
                for artifact_id, artifact in manifest.artifacts.items()
            },
        )

    def satisfies(self, requirements: Iterable[CatalogArtifactRequirement]) -> bool:
        for requirement in requirements:
            artifact = self.artifacts.get(requirement.artifact_id)
            if not isinstance(artifact, dict):
                return False
            components = artifact.get("components")
            if not isinstance(components, list) or tuple(components) != requirement.components:
                return False

        return True

    def to_index_dict(self) -> dict[str, Any]:
        return {
            "run": dict(self.run),
            "frames": [dict(frame) for frame in self.frames],
            "artifacts": {
                artifact_id: dict(artifact)
                for artifact_id, artifact in self.artifacts.items()
            },
        }


def build_index(
    *,
    product_config: LoadedProductConfig,
    artifact_repo: ArtifactRepository,
    generated_at: str | None = None,
    strict_dataset_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Build the frontend manifest index from config and latest manifests."""

    generated_at = generated_at or utc_now_iso()
    pipeline_config = product_config.pipeline_config
    requirements = product_config.catalog_requirements
    strict_dataset_id_set = set(strict_dataset_ids)
    latest_by_dataset = {
        dataset_id: _read_latest_manifest_entry(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            strict=dataset_id in strict_dataset_id_set,
        )
        for dataset_id in pipeline_config.datasets
    }

    return {
        "schema": MANIFEST_INDEX_SCHEMA,
        "schema_version": MANIFEST_INDEX_SCHEMA_VERSION,
        "generated_at": generated_at,
        "catalog_version": product_config.catalog_version,
        "payload_contract": DATA_BINARY_CONTRACT,
        "datasets": {
            dataset_id: {
                "label": dataset.label,
                "latest": _latest_index_dict(latest_by_dataset[dataset_id]),
            }
            for dataset_id, dataset in pipeline_config.datasets.items()
        },
        "layers": {
            layer.layer_id: {
                "datasets": {
                    dataset_id: _layer_dataset_entry(
                        dataset=dataset,
                        layer_requirements=layer,
                        latest_manifest=latest_by_dataset[dataset_id],
                    )
                    for dataset_id, dataset in pipeline_config.datasets.items()
                }
            }
            for layer in requirements.raster_layers
        },
    }


def publish_index(
    *,
    product_config: LoadedProductConfig,
    artifact_repo: ArtifactRepository,
    generated_at: str | None = None,
    strict_dataset_ids: Iterable[str] = (),
) -> str:
    """Generate and publish the current frontend manifest index."""

    manifest = build_index(
        product_config=product_config,
        artifact_repo=artifact_repo,
        generated_at=generated_at,
        strict_dataset_ids=strict_dataset_ids,
    )
    return artifact_repo.write_manifest_index(manifest=manifest)


def read_index_latest_revision(*, artifact_repo: ArtifactRepository, dataset_id: str) -> str | None:
    """Return the dataset latest revision embedded in the stored manifest index."""

    if not artifact_repo.manifest_index_exists():
        return None
    try:
        manifest_index = artifact_repo.read_manifest_index()
    except (FileNotFoundError, ValueError, SystemExit):
        return None
    return _latest_revision_from_index(manifest_index, dataset_id=dataset_id)


def _latest_index_dict(latest_manifest: _LatestManifestEntry | None) -> dict[str, Any] | None:
    if latest_manifest is None:
        return None
    return latest_manifest.to_index_dict()


def _read_latest_manifest_entry(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    strict: bool,
) -> _LatestManifestEntry | None:
    if not artifact_repo.latest_manifest_exists(dataset_id=dataset_id):
        return None
    try:
        manifest = artifact_repo.read_latest_manifest(dataset_id=dataset_id)
    except (FileNotFoundError, ValueError, SystemExit) as exc:
        if strict:
            raise SystemExit(_invalid_latest_manifest_message(dataset_id=dataset_id, exc=exc)) from exc
        print(f"Unable to read latest manifest for manifest index dataset_id={dataset_id}: {exc}")
        return None
    try:
        return _LatestManifestEntry.from_cycle_manifest(manifest)
    except (ValueError, SystemExit) as exc:
        if strict:
            raise SystemExit(_invalid_latest_manifest_message(dataset_id=dataset_id, exc=exc)) from exc
        print(f"Ignoring incompatible latest manifest for manifest index dataset_id={dataset_id}: {exc}")
        return None


def _invalid_latest_manifest_message(*, dataset_id: str, exc: BaseException) -> str:
    return f"latest manifest for dataset {dataset_id!r} is invalid: {exc}"


def _compact_artifact_entry(
    *,
    artifact_id: str,
    artifact: ManifestArtifact,
    frame_ids: tuple[str, ...],
) -> dict[str, Any]:
    artifact_entry = artifact.model_dump(mode="json", exclude_none=True, exclude={"frames"})
    artifact_entry["byte_length"] = _artifact_byte_length(
        artifact_id=artifact_id,
        artifact=artifact,
        frame_ids=frame_ids,
    )
    return artifact_entry


def _artifact_byte_length(
    *,
    artifact_id: str,
    artifact: ManifestArtifact,
    frame_ids: tuple[str, ...],
) -> int:
    byte_length: int | None = None
    for frame_id in frame_ids:
        frame = artifact.frames.get(frame_id)
        if frame is None:
            raise SystemExit(f"latest manifest artifact {artifact_id!r} frame {frame_id!r} must be an object")
        frame_byte_length = frame.byte_length
        if byte_length is None:
            byte_length = frame_byte_length
            continue
        if frame_byte_length != byte_length:
            raise SystemExit(
                "Latest manifest artifact frame byte_length mismatch: "
                f"artifact={artifact_id!r} first={byte_length} {frame_id}={frame_byte_length}"
            )

    if byte_length is None:
        raise SystemExit(f"Latest manifest artifact {artifact_id!r} has no frames")
    return byte_length


def _layer_dataset_entry(
    *,
    dataset: DatasetConfig,
    layer_requirements: CatalogLayerRequirements,
    latest_manifest: _LatestManifestEntry | None,
) -> dict[str, Any]:
    required_artifact_ids = tuple(requirement.artifact_id for requirement in layer_requirements.required)
    optional_artifact_ids = tuple(requirement.artifact_id for requirement in layer_requirements.optional)
    configured = all(artifact_id in dataset.workload.artifacts for artifact_id in required_artifact_ids)
    if not configured:
        return {
            "state": "unsupported",
            "support": "unavailable",
            "required_artifacts": list(required_artifact_ids),
            "optional_artifacts": list(optional_artifact_ids),
        }

    state: _AvailabilityState = (
        "available"
        if latest_manifest is not None and latest_manifest.satisfies(layer_requirements.required)
        else "temporarily_unavailable"
    )

    return {
        "state": state,
        "support": _support_for_dataset(dataset=dataset, layer_requirements=layer_requirements),
        "required_artifacts": list(required_artifact_ids),
        "optional_artifacts": list(optional_artifact_ids),
    }


def _support_for_dataset(*, dataset: DatasetConfig, layer_requirements: CatalogLayerRequirements) -> _LayerSupport:
    first_required = layer_requirements.required[0] if layer_requirements.required else None
    if first_required is None:
        return "unavailable"
    if first_required.components != ("value",):
        return "frontend-derived"

    artifact = dataset.artifacts.get(first_required.artifact_id)
    if artifact is not None and artifact.derivation is not None:
        return "etl-derived"
    return "native"


def _latest_revision_from_index(manifest_index: object, *, dataset_id: str) -> str | None:
    if not isinstance(manifest_index, Mapping):
        return None
    datasets = manifest_index.get("datasets")
    dataset_entry = datasets.get(dataset_id) if isinstance(datasets, Mapping) else None
    latest = dataset_entry.get("latest") if isinstance(dataset_entry, Mapping) else None
    run = latest.get("run") if isinstance(latest, Mapping) else None
    revision = run.get("revision") if isinstance(run, Mapping) else None
    return revision if isinstance(revision, str) else None
