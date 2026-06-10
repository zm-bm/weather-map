"""ETL-relevant catalog.json projection."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..core.validation import NonEmptyStr, parse_model


class _CatalogModel(BaseModel):
    """Immutable catalog subset model that ignores frontend-owned fields."""

    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class _CatalogBand(_CatalogModel):
    id: NonEmptyStr

    @model_validator(mode="before")
    @classmethod
    def _reject_stale_input(cls, raw: object) -> object:
        if isinstance(raw, dict) and "input" in raw:
            raise ValueError("Catalog source bands must not define 'input'")
        return raw


class _CatalogSource(_CatalogModel):
    artifact_id: NonEmptyStr = Field(alias="artifactId")
    bands: tuple[_CatalogBand, ...] = ()

    @model_validator(mode="after")
    def _validate_bands(self) -> "_CatalogSource":
        if not self.bands:
            raise ValueError("Catalog source must define non-empty bands")
        return self

    @property
    def band_ids(self) -> tuple[str, ...]:
        return tuple(band.id for band in self.bands)


class _RasterLayer(_CatalogModel):
    id: NonEmptyStr
    source: _CatalogSource
    overlays: tuple[NonEmptyStr, ...] = ()


class _OverlayLayer(_CatalogModel):
    id: NonEmptyStr
    style: NonEmptyStr
    source: _CatalogSource
    optional: bool = False

    @model_validator(mode="after")
    def _validate_style(self) -> "_OverlayLayer":
        if self.style != "precipitation-type-pattern":
            raise ValueError(f"Unsupported layer overlay style: {self.style!r}")
        return self


class _SourceLayer(_CatalogModel):
    id: NonEmptyStr
    source: _CatalogSource


class _CatalogDocument(_CatalogModel):
    catalog_version: NonEmptyStr = Field(alias="catalogVersion")
    raster_layers: tuple[_RasterLayer, ...] = Field(alias="rasterLayers")
    overlay_layers: tuple[_OverlayLayer, ...] = Field(default=(), alias="overlayLayers")
    contour_layers: tuple[_SourceLayer, ...] = Field(default=(), alias="contourLayers")
    particle_layers: tuple[_SourceLayer, ...] = Field(default=(), alias="particleLayers")

    @model_validator(mode="after")
    def _validate_layer_identity(self) -> "_CatalogDocument":
        _validate_unique_layer_ids("rasterLayers", self.raster_layers)
        _validate_unique_layer_ids("overlayLayers", self.overlay_layers)
        _validate_unique_layer_ids("contourLayers", self.contour_layers)
        _validate_unique_layer_ids("particleLayers", self.particle_layers)
        _validate_overlay_references(self.raster_layers, self.overlay_layers)
        return self


def parse_catalog(catalog: object) -> _CatalogDocument:
    """Parse the ETL-relevant subset of catalog.json."""

    return parse_model(_CatalogDocument, catalog)


@dataclass(frozen=True)
class CatalogArtifactRequirement:
    """One artifact/component requirement declared by a catalog source."""

    artifact_id: str
    components: tuple[str, ...]


@dataclass(frozen=True)
class CatalogLayerRequirements:
    """Artifact requirements for one catalog layer."""

    layer_id: str
    required: tuple[CatalogArtifactRequirement, ...]
    optional: tuple[CatalogArtifactRequirement, ...]


@dataclass(frozen=True)
class CatalogRequirements:
    """Catalog artifact requirements needed by ETL and manifest indexing."""

    raster_layers: tuple[CatalogLayerRequirements, ...]
    all_requirements: tuple[CatalogArtifactRequirement, ...]

    @property
    def source_artifact_ids(self) -> set[str]:
        """Artifact ids referenced by any catalog source."""

        return {requirement.artifact_id for requirement in self.all_requirements}


def catalog_requirements(catalog: Mapping[str, Any]) -> CatalogRequirements:
    """Parse catalog source references into typed artifact requirements."""

    parsed_catalog = parse_catalog(catalog)
    overlays_by_id = {layer.id: layer for layer in parsed_catalog.overlay_layers}
    raster_layers = tuple(
        _raster_layer_requirements(layer, overlays_by_id=overlays_by_id)
        for layer in parsed_catalog.raster_layers
    )
    top_level_layers = (
        *(_overlay_layer_requirements(overlay) for overlay in parsed_catalog.overlay_layers),
        *(_direct_source_layer_requirements(layer) for layer in parsed_catalog.contour_layers),
        *(_direct_source_layer_requirements(layer) for layer in parsed_catalog.particle_layers),
    )
    return CatalogRequirements(
        raster_layers=raster_layers,
        all_requirements=_all_requirements((*raster_layers, *top_level_layers)),
    )


def _raster_layer_requirements(
    layer: _RasterLayer,
    *,
    overlays_by_id: Mapping[str, _OverlayLayer],
) -> CatalogLayerRequirements:
    source_requirements = _source_layer_requirements(layer_id=layer.id, source=layer.source, optional=False)
    required = list(source_requirements.required)
    optional_requirements = list(source_requirements.optional)

    for overlay_id in layer.overlays:
        overlay_requirements = _overlay_layer_requirements(overlays_by_id[overlay_id])
        required.extend(overlay_requirements.required)
        optional_requirements.extend(overlay_requirements.optional)

    required_tuple = _dedupe_requirements(required)
    optional_tuple = tuple(
        requirement
        for requirement in _dedupe_requirements(optional_requirements)
        if requirement not in required_tuple
    )
    return CatalogLayerRequirements(
        layer_id=layer.id,
        required=required_tuple,
        optional=optional_tuple,
    )


def _overlay_layer_requirements(overlay: _OverlayLayer) -> CatalogLayerRequirements:
    return _source_layer_requirements(layer_id=overlay.id, source=overlay.source, optional=overlay.optional)


def _direct_source_layer_requirements(layer: _SourceLayer) -> CatalogLayerRequirements:
    return _source_layer_requirements(layer_id=layer.id, source=layer.source, optional=False)


def _source_layer_requirements(
    *,
    layer_id: str,
    source: _CatalogSource,
    optional: bool,
) -> CatalogLayerRequirements:
    requirement = _source_requirement(source)
    return CatalogLayerRequirements(
        layer_id=layer_id,
        required=() if optional else (requirement,),
        optional=(requirement,) if optional else (),
    )


def _source_requirement(source: _CatalogSource) -> CatalogArtifactRequirement:
    return CatalogArtifactRequirement(source.artifact_id, source.band_ids)


def _dedupe_requirements(
    requirements: Iterable[CatalogArtifactRequirement],
) -> tuple[CatalogArtifactRequirement, ...]:
    seen: set[CatalogArtifactRequirement] = set()
    deduped: list[CatalogArtifactRequirement] = []
    for requirement in requirements:
        if requirement in seen:
            continue
        seen.add(requirement)
        deduped.append(requirement)
    return tuple(deduped)


def _all_requirements(layers: Iterable[CatalogLayerRequirements]) -> tuple[CatalogArtifactRequirement, ...]:
    requirements: list[CatalogArtifactRequirement] = []
    for layer in layers:
        requirements.extend(layer.required)
        requirements.extend(layer.optional)
    return _dedupe_requirements(requirements)


def _validate_unique_layer_ids(owner: str, layers: Iterable[Any]) -> None:
    seen: set[str] = set()
    for layer in layers:
        layer_id = layer.id
        if layer_id in seen:
            raise ValueError(f"Catalog {owner} contains duplicate id: {layer_id!r}")
        seen.add(layer_id)


def _validate_overlay_references(
    raster_layers: tuple[_RasterLayer, ...],
    overlays: tuple[_OverlayLayer, ...],
) -> None:
    overlay_ids = {layer.id for layer in overlays}
    for raster_layer in raster_layers:
        for overlay_id in raster_layer.overlays:
            if overlay_id not in overlay_ids:
                raise ValueError(f"Layer {raster_layer.id!r} references missing overlay layer {overlay_id!r}")
