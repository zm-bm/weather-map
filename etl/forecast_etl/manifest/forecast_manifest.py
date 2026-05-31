"""Forecast manifest generation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Literal, Mapping

from ..artifacts.repository import ArtifactRepository
from ..catalog import load_forecast_catalog
from ..config.resolved import ModelConfig, PipelineConfig
from .constants import FORECAST_BINARY_CONTRACT

FORECAST_MANIFEST_SCHEMA = "weather-map.forecast-manifest"
FORECAST_MANIFEST_SCHEMA_VERSION = 1

AvailabilityState = Literal["available", "unsupported", "temporarily_unavailable"]
LayerSupport = Literal["native", "frontend-derived", "etl-derived", "unavailable"]
ArtifactKind = Literal["scalar", "vector"]

@dataclass(frozen=True)
class ArtifactRequirement:
    """One artifact required or optionally consumed by a catalog layer."""

    artifact_id: str
    kind: ArtifactKind
    components: tuple[str, ...] = ()


@dataclass(frozen=True)
class LayerRequirements:
    """Artifacts and frontend support shape for one catalog layer."""

    required: tuple[ArtifactRequirement, ...]
    optional: tuple[ArtifactRequirement, ...]
    support_hint: LayerSupport


def build_forecast_manifest(
    *,
    pipeline_config: PipelineConfig,
    artifact_repo: ArtifactRepository,
    generated_at: str | None = None,
    catalog: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the frontend forecast manifest from config and latest manifests."""

    forecast_catalog = dict(catalog) if catalog is not None else load_forecast_catalog()
    generated_at = generated_at or _utc_now_iso()
    latest_manifests = {
        model_id: _read_latest_manifest(artifact_repo=artifact_repo, model_id=model_id)
        for model_id in pipeline_config.models
    }
    embedded_latest_manifests: dict[str, dict[str, Any] | None] = {}
    compatible_latest_manifests: dict[str, Mapping[str, Any] | None] = {}
    for model_id, latest_manifest in latest_manifests.items():
        embedded_latest = _safe_embedded_latest_manifest(
            model_id=model_id,
            manifest=latest_manifest,
        )
        embedded_latest_manifests[model_id] = embedded_latest
        compatible_latest_manifests[model_id] = latest_manifest if embedded_latest is not None else None

    overlay_layers_by_id = _catalog_overlay_layers_by_id(forecast_catalog)

    return {
        "schema": FORECAST_MANIFEST_SCHEMA,
        "schemaVersion": FORECAST_MANIFEST_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "catalogVersion": str(forecast_catalog["catalogVersion"]),
        "payloadContract": FORECAST_BINARY_CONTRACT,
        "models": {
            model_id: {
                "label": model.label,
                "latest": embedded_latest_manifests[model_id],
            }
            for model_id, model in pipeline_config.models.items()
        },
        "layers": {
            str(layer["id"]): {
                "models": {
                    model_id: _layer_model_entry(
                        model=model,
                        layer_requirements=_layer_requirements(
                            layer,
                            overlay_layers_by_id=overlay_layers_by_id,
                        ),
                        latest_manifest=compatible_latest_manifests[model_id],
                    )
                    for model_id, model in pipeline_config.models.items()
                }
            }
            for layer in _catalog_layers(forecast_catalog)
        },
    }


def publish_forecast_manifest(
    *,
    pipeline_config: PipelineConfig,
    artifact_repo: ArtifactRepository,
    generated_at: str | None = None,
) -> str:
    """Generate and publish the current frontend forecast manifest."""

    manifest = build_forecast_manifest(
        pipeline_config=pipeline_config,
        artifact_repo=artifact_repo,
        generated_at=generated_at,
    )
    return artifact_repo.write_forecast_manifest(manifest=manifest)


def _catalog_layers(catalog: Mapping[str, Any]) -> Iterable[Mapping[str, Any]]:
    layers = catalog.get("rasterLayers")
    if not isinstance(layers, list):
        raise SystemExit("Forecast catalog must contain a rasterLayers array")
    for layer in layers:
        if not isinstance(layer, dict):
            raise SystemExit("Forecast catalog rasterLayers must be objects")
        yield layer


def _catalog_overlay_layers_by_id(catalog: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    overlay_layers = catalog.get("overlayLayers", [])
    if not isinstance(overlay_layers, list):
        raise SystemExit("Forecast catalog overlayLayers must be a list")

    overlays_by_id: dict[str, Mapping[str, Any]] = {}
    for overlay in overlay_layers:
        if not isinstance(overlay, dict):
            raise SystemExit("Forecast catalog overlayLayers must be objects")
        overlay_id = overlay.get("id")
        if overlay_id is None:
            raise SystemExit("Forecast catalog overlayLayers entries must contain id")
        overlays_by_id[str(overlay_id)] = overlay
    return overlays_by_id


def _embedded_latest_manifest(manifest: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if manifest is None:
        return None

    run = _required_mapping(manifest, "run", owner="latest manifest")
    times = _required_list(manifest, "times", owner="latest manifest")
    artifacts = _required_mapping(manifest, "artifacts", owner="latest manifest")
    time_ids = tuple(_time_id(time, index=index) for index, time in enumerate(times))
    if not time_ids:
        raise SystemExit("Latest manifest must contain at least one time")

    return {
        "run": dict(run),
        "times": [
            dict(_as_mapping(time, owner=f"latest manifest time {index}"))
            for index, time in enumerate(times)
        ],
        "artifacts": {
            str(artifact_id): _embedded_artifact(
                artifact_id=str(artifact_id),
                artifact=artifact,
                time_ids=time_ids,
            )
            for artifact_id, artifact in artifacts.items()
        },
    }


def _safe_embedded_latest_manifest(*, model_id: str, manifest: Any) -> dict[str, Any] | None:
    try:
        return _embedded_latest_manifest(manifest)
    except (Exception, SystemExit) as exc:
        print(f"Ignoring incompatible latest manifest for forecast manifest model={model_id}: {exc}")
        return None


def _embedded_artifact(*, artifact_id: str, artifact: Any, time_ids: tuple[str, ...]) -> dict[str, Any]:
    artifact_mapping = _as_mapping(artifact, owner=f"latest manifest artifact {artifact_id!r}")
    artifact_entry = dict(artifact_mapping)
    frames = _as_mapping(
        artifact_entry.pop("frames", None),
        owner=f"latest manifest artifact {artifact_id!r} frames",
    )
    artifact_entry.pop("path", None)
    artifact_entry.pop("sha256", None)
    artifact_entry["byteLength"] = _artifact_byte_length(
        artifact_id=artifact_id,
        frames=frames,
        time_ids=time_ids,
    )
    return artifact_entry


def _artifact_byte_length(
    *,
    artifact_id: str,
    frames: Mapping[str, Any],
    time_ids: tuple[str, ...],
) -> int:
    byte_length: int | None = None
    for time_id in time_ids:
        frame = _as_mapping(
            frames.get(time_id),
            owner=f"latest manifest artifact {artifact_id!r} frame {time_id!r}",
        )
        frame_byte_length = _positive_int(
            frame.get("byteLength"),
            owner=f"latest manifest artifact {artifact_id!r} frame {time_id!r} byteLength",
        )
        if byte_length is None:
            byte_length = frame_byte_length
            continue
        if frame_byte_length != byte_length:
            raise SystemExit(
                "Latest manifest artifact frame byteLength mismatch: "
                f"artifact={artifact_id!r} first={byte_length} {time_id}={frame_byte_length}"
            )

    if byte_length is None:
        raise SystemExit(f"Latest manifest artifact {artifact_id!r} has no frames")
    return byte_length


def _layer_model_entry(
    *,
    model: ModelConfig,
    layer_requirements: LayerRequirements,
    latest_manifest: Mapping[str, Any] | None,
) -> dict[str, Any]:
    required_artifact_ids = tuple(requirement.artifact_id for requirement in layer_requirements.required)
    optional_artifact_ids = tuple(requirement.artifact_id for requirement in layer_requirements.optional)
    configured = all(artifact_id in model.workload.artifacts for artifact_id in required_artifact_ids)
    if not configured:
        return {
            "state": "unsupported",
            "support": "unavailable",
            "requiredArtifacts": list(required_artifact_ids),
            "optionalArtifacts": list(optional_artifact_ids),
        }

    state: AvailabilityState = (
        "available"
        if latest_manifest is not None and _manifest_satisfies(latest_manifest, layer_requirements.required)
        else "temporarily_unavailable"
    )

    return {
        "state": state,
        "support": _support_for_model(model=model, layer_requirements=layer_requirements),
        "requiredArtifacts": list(required_artifact_ids),
        "optionalArtifacts": list(optional_artifact_ids),
    }


def _support_for_model(*, model: ModelConfig, layer_requirements: LayerRequirements) -> LayerSupport:
    if layer_requirements.support_hint == "frontend-derived":
        return layer_requirements.support_hint

    first_required = layer_requirements.required[0] if layer_requirements.required else None
    if first_required is None:
        return "unavailable"

    artifact = model.artifacts.get(first_required.artifact_id)
    if artifact is not None and artifact.derivation is not None:
        return "etl-derived"
    return "native"


def _manifest_satisfies(
    manifest: Mapping[str, Any],
    requirements: Iterable[ArtifactRequirement],
) -> bool:
    if not isinstance(manifest, Mapping):
        return False

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        return False

    for requirement in requirements:
        artifact = artifacts.get(requirement.artifact_id)
        if not isinstance(artifact, dict):
            return False
        if artifact.get("kind") != requirement.kind:
            return False
        if requirement.components:
            components = artifact.get("components")
            if not isinstance(components, list) or tuple(components) != requirement.components:
                return False

    return True


def _layer_requirements(
    layer: Mapping[str, Any],
    *,
    overlay_layers_by_id: Mapping[str, Mapping[str, Any]],
) -> LayerRequirements:
    source = layer.get("source")
    if not isinstance(source, dict):
        raise SystemExit(f"Layer {layer.get('id')!r} must contain a source object")

    requirements = _source_requirements(source, optional=False)
    required = list(requirements.required)
    optional_requirements = list(requirements.optional)

    overlays = layer.get("overlays", [])
    if not isinstance(overlays, list):
        raise SystemExit(f"Layer {layer.get('id')!r} overlays must be a list")

    for overlay in overlays:
        if not isinstance(overlay, str):
            raise SystemExit(f"Layer {layer.get('id')!r} overlays must reference overlay layer ids")
        overlay_layer = overlay_layers_by_id.get(overlay)
        if overlay_layer is None:
            raise SystemExit(f"Layer {layer.get('id')!r} references missing overlay layer {overlay!r}")
        overlay_requirements = _layer_overlay_requirements(
            overlay_layer,
            optional=bool(overlay_layer.get("optional")),
        )
        required.extend(overlay_requirements.required)
        optional_requirements.extend(overlay_requirements.optional)

    required_tuple = _dedupe_requirements(required)
    optional_tuple = tuple(
        requirement
        for requirement in _dedupe_requirements(optional_requirements)
        if requirement not in required_tuple
    )
    return LayerRequirements(
        required=required_tuple,
        optional=optional_tuple,
        support_hint=requirements.support_hint,
    )


def _layer_overlay_requirements(overlay: Mapping[str, Any], *, optional: bool) -> LayerRequirements:
    overlay_style = overlay.get("style")
    if overlay_style == "precipitation-type-pattern":
        source = overlay.get("source")
        if not isinstance(source, dict):
            raise SystemExit("Precipitation-type pattern layer overlay must contain a source object")
        return _source_requirements(source, optional=optional)

    raise SystemExit(f"Unsupported layer overlay style: {overlay_style!r}")


def _dedupe_requirements(requirements: Iterable[ArtifactRequirement]) -> tuple[ArtifactRequirement, ...]:
    seen: set[ArtifactRequirement] = set()
    deduped: list[ArtifactRequirement] = []
    for requirement in requirements:
        if requirement in seen:
            continue
        seen.add(requirement)
        deduped.append(requirement)
    return tuple(deduped)


def _source_requirements(source: Mapping[str, Any], *, optional: bool) -> LayerRequirements:
    band_ids = _source_band_ids(source)
    if band_ids == ("value",):
        requirement = ArtifactRequirement(str(source["artifactId"]), "scalar")
        return LayerRequirements(
            required=() if optional else (requirement,),
            optional=(requirement,) if optional else (),
            support_hint="native",
        )

    requirement = ArtifactRequirement(str(source["artifactId"]), "vector", band_ids)
    return LayerRequirements(
        required=() if optional else (requirement,),
        optional=(requirement,) if optional else (),
        support_hint="frontend-derived",
    )


def _source_band_ids(source: Mapping[str, Any]) -> tuple[str, ...]:
    bands = source.get("bands")
    has_bands = isinstance(bands, list) and bool(bands)
    if not has_bands:
        raise SystemExit("Raster source must define non-empty bands")

    return tuple(
        _raster_band_id(_as_mapping(band, owner="raster source band"))
        for band in bands
    )


def _raster_band_id(band: Mapping[str, Any]) -> str:
    if "input" in band:
        raise SystemExit("Raster source bands must not define 'input'")
    return str(_required_value(band, "id", owner="raster source band"))


def _read_latest_manifest(*, artifact_repo: ArtifactRepository, model_id: str) -> dict[str, Any] | None:
    if not artifact_repo.latest_manifest_exists(model_id=model_id):
        return None
    try:
        return artifact_repo.read_latest_manifest(model_id=model_id)
    except Exception as exc:
        print(f"Unable to read latest manifest for forecast manifest model={model_id}: {exc}")
        return None


def _required_value(mapping: Mapping[str, Any], key: str, *, owner: str) -> Any:
    value = mapping.get(key)
    if value is None:
        raise SystemExit(f"{owner} must contain {key!r}")
    return value


def _required_mapping(mapping: Mapping[str, Any], key: str, *, owner: str) -> Mapping[str, Any]:
    return _as_mapping(
        _required_value(mapping, key, owner=owner),
        owner=f"{owner} {key!r}",
    )


def _required_list(mapping: Mapping[str, Any], key: str, *, owner: str) -> list[Any]:
    value = _required_value(mapping, key, owner=owner)
    if not isinstance(value, list):
        raise SystemExit(f"{owner} {key!r} must be a list")
    return value


def _as_mapping(value: Any, *, owner: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise SystemExit(f"{owner} must be an object")
    return value


def _time_id(time: Any, *, index: int) -> str:
    time_mapping = _as_mapping(time, owner=f"latest manifest time {index}")
    time_id = _required_value(time_mapping, "id", owner=f"latest manifest time {index}")
    return str(time_id)


def _positive_int(value: Any, *, owner: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise SystemExit(f"{owner} must be a positive integer")
    return value


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
