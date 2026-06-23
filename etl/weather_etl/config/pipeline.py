"""Resolved pipeline.json models."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, TypeAlias

from pydantic import ConfigDict, Field, field_validator, model_validator

from ..core.frames import format_lead_hour_frame_id, validate_frame_id
from ..core.validation import (
    FiniteNumber,
    FrozenModel,
    LeadHourFrameInt,
    NonEmptyStr,
    NonEmptyStringMap,
    PositiveInt,
    UniqueNonEmptyStringTuple,
    parse_model,
)
from ._json import read_json_object
from .encoding import EncodingSpec
from .sources import MRMS_AWS_S3_SOURCE_TYPE, validate_source_type

if TYPE_CHECKING:
    from ..storage.base import UriStore

ArtifactKind: TypeAlias = Literal["scalar", "vector"]
DatasetMode: TypeAlias = Literal["forecast_cycle", "rolling_observed"]

class WorkloadInput(FrozenModel):
    """Raw workload frame and artifact selection."""

    frame_start: LeadHourFrameInt | None = None
    frame_end: LeadHourFrameInt | None = None
    explicit_frames: UniqueNonEmptyStringTuple | None = Field(default=None, alias="frames")
    artifacts: UniqueNonEmptyStringTuple | None = None

    @model_validator(mode="after")
    def _validate_range(self) -> "WorkloadInput":
        has_range = self.frame_start is not None or self.frame_end is not None
        if self.explicit_frames is not None:
            if has_range:
                raise ValueError("workload.frames must not be combined with frame_start/frame_end")
            return self
        if not has_range:
            return self
        if self.frame_start is None or self.frame_end is None:
            raise ValueError("workload frame_start and frame_end must be defined together")
        if self.frame_end < self.frame_start:
            raise ValueError("frame_end must be greater than or equal to frame_start")
        return self

    @property
    def frames(self) -> tuple[str, ...]:
        if self.explicit_frames is not None:
            return tuple(validate_frame_id(frame_id) for frame_id in self.explicit_frames)
        if self.frame_start is None or self.frame_end is None:
            return ()
        return tuple(format_lead_hour_frame_id(hour) for hour in range(self.frame_start, self.frame_end + 1))


class SourceConfig(FrozenModel):
    """Raw source config with source-specific fields preserved."""

    model_config = ConfigDict(extra="allow", frozen=True, str_strip_whitespace=True)

    type: NonEmptyStr
    grid_id: NonEmptyStr

    @property
    def raw(self) -> dict[str, Any]:
        """JSON-compatible source config, including source-specific fields."""

        return self.model_dump(mode="json")


class PipelineComponentInput(FrozenModel):
    id: NonEmptyStr


class ArtifactComponentInput(FrozenModel):
    id: NonEmptyStr
    grib_match: NonEmptyStringMap | None = None


class ArtifactTemporalSpec(FrozenModel):
    kind: Literal["instantaneous_rate", "average_rate", "accumulation"]
    source_interval_hours: FiniteNumber | None = None

    @model_validator(mode="after")
    def _validate_interval(self) -> "ArtifactTemporalSpec":
        if self.source_interval_hours is not None and self.source_interval_hours <= 0:
            raise ValueError("source_interval_hours must be positive when provided")
        return self


class ArtifactGridTransformSpec(FrozenModel):
    type: Literal["regular_grid_downsample_2x"]
    grid_id: NonEmptyStr


class DerivationInputSpec(FrozenModel):
    id: NonEmptyStr
    grib_match: NonEmptyStringMap


class ArtifactDerivationSpec(FrozenModel):
    type: NonEmptyStr
    first_hour_previous: Literal["zero"] | None = None
    inputs: tuple[DerivationInputSpec, ...] = ()


class PipelineArtifactInput(FrozenModel):
    """Raw pipeline artifact definition with component identities only."""

    kind: Literal["scalar", "vector"]
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    encoding: EncodingSpec
    source_transform: Literal["identity", "kg_m2_s_to_mm_hr", "cin_magnitude"] = "identity"
    components: tuple[PipelineComponentInput, ...] = Field(min_length=1)

    @field_validator("source_transform", mode="before")
    @classmethod
    def _strip_source_transform(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _validate_components(self) -> "PipelineArtifactInput":
        component_ids = tuple(component.id for component in self.components)
        _validate_unique_component_ids(component_ids)
        if self.kind == "scalar" and component_ids != ("value",):
            raise ValueError("scalar artifacts must define exactly the value component")
        if self.kind == "vector" and component_ids == ("value",):
            raise ValueError("vector artifacts must not define exactly the value component")
        return self

    @property
    def component_ids(self) -> tuple[str, ...]:
        return tuple(component.id for component in self.components)


class DatasetArtifactInput(FrozenModel):
    """Raw dataset artifact component-to-GRIB selector mapping."""

    components: tuple[ArtifactComponentInput, ...] = Field(min_length=1)
    temporal: ArtifactTemporalSpec | None = None
    derivation: ArtifactDerivationSpec | None = None
    grid_transform: ArtifactGridTransformSpec | None = None

    @model_validator(mode="after")
    def _validate_components(self) -> "DatasetArtifactInput":
        _validate_unique_component_ids(tuple(component.id for component in self.components))
        return self

    @property
    def component_grib_matches(self) -> dict[str, dict[str, str] | None]:
        return {
            component.id: dict(component.grib_match) if component.grib_match is not None else None
            for component in self.components
        }


class DatasetLifecycleConfig(FrozenModel):
    """Optional lifecycle policy for datasets whose public view is not one cycle."""

    type: Literal["rolling_observed"]
    display_window_minutes: PositiveInt
    publish_scan_minutes: PositiveInt

    @model_validator(mode="after")
    def _validate_scan_window(self) -> "DatasetLifecycleConfig":
        if self.publish_scan_minutes < self.display_window_minutes:
            raise ValueError("publish_scan_minutes must be greater than or equal to display_window_minutes")
        return self


def _validate_unique_component_ids(component_ids: tuple[str, ...]) -> None:
    seen: set[str] = set()
    for component_id in component_ids:
        if component_id in seen:
            raise ValueError(f"duplicate component id: {component_id!r}")
        seen.add(component_id)


class DatasetConfigInput(FrozenModel):
    """Raw dataset config before catalog artifacts are resolved."""

    label: NonEmptyStr
    source: SourceConfig
    workload: WorkloadInput | None = None
    artifacts: dict[NonEmptyStr, DatasetArtifactInput] = Field(min_length=1)
    lifecycle: DatasetLifecycleConfig | None = None


class PipelineConfigInput(FrozenModel):
    """Raw top-level pipeline config shape."""

    version: Literal[3]
    artifact_catalog: dict[NonEmptyStr, PipelineArtifactInput] = Field(min_length=1)
    datasets: dict[NonEmptyStr, DatasetConfigInput] = Field(min_length=1)


class WorkloadConfig(FrozenModel):
    """Resolved frame and artifact selection for one dataset."""

    frames: tuple[str, ...]
    artifacts: UniqueNonEmptyStringTuple

    @classmethod
    def from_input(
        cls,
        raw: WorkloadInput | None,
        *,
        mode: DatasetMode,
        dataset_artifact_ids: tuple[str, ...],
    ) -> "WorkloadConfig":
        """Parse a raw workload range into configured lead-hour frame ids."""

        artifact_ids = raw.artifacts if raw is not None and raw.artifacts is not None else dataset_artifact_ids
        for artifact_id in artifact_ids:
            if artifact_id not in dataset_artifact_ids:
                raise SystemExit(f"workload.artifacts references unknown artifact: {artifact_id!r}")
        frames = raw.frames if raw is not None else ()
        if mode == "forecast_cycle" and not frames:
            raise SystemExit("forecast_cycle datasets must define workload frames")
        return cls(frames=frames, artifacts=artifact_ids)


class ComponentSpec(FrozenModel):
    """Resolved artifact component and its source metadata selector."""

    id: NonEmptyStr
    grib_match: NonEmptyStringMap | None = None


class PipelineArtifactSpec(FrozenModel):
    """Reusable artifact definition before dataset-specific selectors."""

    id: NonEmptyStr
    kind: ArtifactKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    component_ids: UniqueNonEmptyStringTuple

    @classmethod
    def from_input(cls, artifact_id: str, raw: PipelineArtifactInput) -> "PipelineArtifactSpec":
        """Parse one shared pipeline artifact definition."""

        return cls(
            id=artifact_id,
            kind=raw.kind,
            parameter=raw.parameter,
            level=raw.level,
            units=raw.units,
            source_transform=raw.source_transform,
            encoding=raw.encoding,
            component_ids=raw.component_ids,
        )


class ArtifactSpec(FrozenModel):
    """Fully resolved artifact ready for extraction, encoding, and publishing."""

    id: NonEmptyStr
    kind: ArtifactKind
    parameter: NonEmptyStr
    level: NonEmptyStr
    units: NonEmptyStr
    source_transform: NonEmptyStr
    encoding: EncodingSpec
    components: tuple[ComponentSpec, ...]
    temporal: ArtifactTemporalSpec | None = None
    derivation: ArtifactDerivationSpec | None = None
    grid_transform: ArtifactGridTransformSpec | None = None

    @property
    def component_ids(self) -> tuple[str, ...]:
        """Component identifiers in payload packing order."""

        return tuple(component.id for component in self.components)

    @property
    def component_grib_matches(self) -> dict[str, dict[str, str] | None]:
        """Component-to-GRIB selectors by component id."""

        return {
            component.id: dict(component.grib_match) if component.grib_match is not None else None
            for component in self.components
        }

    @classmethod
    def from_pipeline_and_dataset(
        cls,
        *,
        pipeline_artifact: PipelineArtifactSpec,
        dataset_artifact: DatasetArtifactInput,
    ) -> "ArtifactSpec":
        """Merge pipeline metadata with dataset-specific selectors into a runnable artifact."""

        matches = dataset_artifact.component_grib_matches
        expected = pipeline_artifact.component_ids
        actual = tuple(matches)
        if actual != expected:
            raise SystemExit(
                f"artifacts.{pipeline_artifact.id}.components must match artifact_catalog order "
                f"{list(expected)!r}, got {list(actual)!r}"
            )
        _validate_selector_placement(
            artifact_id=pipeline_artifact.id,
            derivation=dataset_artifact.derivation,
            component_grib_matches=matches,
        )

        components = tuple(
            ComponentSpec(
                id=component_id,
                grib_match=matches[component_id],
            )
            for component_id in pipeline_artifact.component_ids
        )
        return cls(
            id=pipeline_artifact.id,
            kind=pipeline_artifact.kind,
            parameter=pipeline_artifact.parameter,
            level=pipeline_artifact.level,
            units=pipeline_artifact.units,
            source_transform=pipeline_artifact.source_transform,
            encoding=pipeline_artifact.encoding,
            components=components,
            temporal=dataset_artifact.temporal,
            derivation=dataset_artifact.derivation,
            grid_transform=dataset_artifact.grid_transform,
        )


def _validate_selector_placement(
    *,
    artifact_id: str,
    derivation: ArtifactDerivationSpec | None,
    component_grib_matches: Mapping[str, Mapping[str, str] | None],
) -> None:
    if derivation is None:
        for component_id, grib_match in component_grib_matches.items():
            if grib_match is None:
                raise SystemExit(
                    f"artifacts.{artifact_id}.components.{component_id} direct artifact component must define grib_match"
                )
        return

    for component_id, grib_match in component_grib_matches.items():
        if grib_match is not None:
            raise SystemExit(
                f"artifacts.{artifact_id}.components.{component_id} derived output component must not define grib_match"
            )


def _derive_dataset_mode(*, dataset_id: str, source_type: str, lifecycle_type: str | None) -> DatasetMode:
    if source_type == MRMS_AWS_S3_SOURCE_TYPE and lifecycle_type == "rolling_observed":
        return "rolling_observed"
    if source_type != MRMS_AWS_S3_SOURCE_TYPE and lifecycle_type is None:
        return "forecast_cycle"

    lifecycle_desc = lifecycle_type or "none"
    raise SystemExit(
        "Unsupported dataset mode: "
        f"dataset_id={dataset_id!r} source_type={source_type!r} lifecycle={lifecycle_desc!r}"
    )


class DatasetConfig(FrozenModel):
    """Resolved config for one dataset."""

    id: NonEmptyStr
    label: NonEmptyStr
    source: SourceConfig
    workload: WorkloadConfig
    artifacts: dict[str, ArtifactSpec]
    lifecycle: DatasetLifecycleConfig | None = None
    mode: DatasetMode = Field(exclude=True)

    @classmethod
    def from_input(
        cls,
        *,
        dataset_id: str,
        raw: DatasetConfigInput,
        artifact_catalog: Mapping[str, PipelineArtifactSpec],
    ) -> "DatasetConfig":
        """Resolve one raw dataset config against the shared pipeline artifact catalog."""

        validate_source_type(dataset_id=dataset_id, source_type=raw.source.type)
        mode = _derive_dataset_mode(
            dataset_id=dataset_id,
            source_type=raw.source.type,
            lifecycle_type=raw.lifecycle.type if raw.lifecycle is not None else None,
        )
        resolved_artifacts = {}
        for artifact_id, raw_dataset_artifact in raw.artifacts.items():
            pipeline_artifact = artifact_catalog.get(artifact_id)
            if pipeline_artifact is None:
                raise SystemExit(f"datasets.{dataset_id}.artifacts references unknown artifact: {artifact_id!r}")
            resolved_artifact = ArtifactSpec.from_pipeline_and_dataset(
                pipeline_artifact=pipeline_artifact,
                dataset_artifact=raw_dataset_artifact,
            )
            resolved_artifacts[artifact_id] = resolved_artifact

        return cls(
            id=dataset_id,
            label=raw.label,
            source=raw.source,
            workload=WorkloadConfig.from_input(
                raw.workload,
                mode=mode,
                dataset_artifact_ids=tuple(raw.artifacts),
            ),
            artifacts=resolved_artifacts,
            lifecycle=raw.lifecycle,
            mode=mode,
        )


class PipelineConfig(FrozenModel):
    """Resolved ETL config containing the artifact catalog and configured datasets."""

    artifact_catalog: dict[str, PipelineArtifactSpec]
    datasets: dict[str, DatasetConfig]

    @classmethod
    def from_input(cls, raw: PipelineConfigInput) -> "PipelineConfig":
        """Resolve a structurally parsed pipeline config into runnable config."""

        artifact_catalog = {
            artifact_id: PipelineArtifactSpec.from_input(artifact_id=artifact_id, raw=artifact_cfg)
            for artifact_id, artifact_cfg in raw.artifact_catalog.items()
        }

        return cls(
            artifact_catalog=artifact_catalog,
            datasets={
                dataset_id: DatasetConfig.from_input(
                    dataset_id=dataset_id,
                    raw=dataset_cfg,
                    artifact_catalog=artifact_catalog,
                )
                for dataset_id, dataset_cfg in raw.datasets.items()
            },
        )

    def dataset(self, dataset_id: str) -> DatasetConfig:
        """Return a configured dataset or fail with the available dataset ids."""

        dataset = self.datasets.get(dataset_id)
        if dataset is None:
            raise SystemExit(f"Unknown dataset {dataset_id!r}; configured datasets: {sorted(self.datasets)!r}")
        return dataset


@dataclass(frozen=True)
class LoadedPipelineConfig:
    """Effective raw config plus parsed resolved config."""

    raw: dict[str, Any]
    config: PipelineConfig


def parse_pipeline_config(obj: Mapping[str, Any]) -> PipelineConfig:
    """Parse raw config JSON into a resolved `PipelineConfig`.

    This validates the config structure, catalog/dataset artifact merge,
    workload references, encoding contracts, and selector placement.
    Source-specific executable settings and derivation behavior are validated
    by source/processing code when they consume them.
    """

    return PipelineConfig.from_input(parse_model(PipelineConfigInput, obj))


def load_pipeline_config_document(
    pipeline_uri: str,
    *,
    store: "UriStore | None" = None,
) -> LoadedPipelineConfig:
    """Read one pipeline config document and return both raw and parsed config."""

    from ..storage.routing import make_store

    resolved_store = store if store is not None else make_store()
    obj = read_json_object(
        uri=pipeline_uri,
        store=resolved_store,
        parse_description="pipeline config",
        object_description="Pipeline config",
        object_requirement="a JSON object",
    )
    return LoadedPipelineConfig(raw=obj, config=parse_pipeline_config(obj))
