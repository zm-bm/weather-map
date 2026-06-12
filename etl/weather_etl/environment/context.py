"""Runtime request and execution context models."""

from __future__ import annotations

from pydantic import field_validator

from ..core.frames import validate_frame_id
from ..core.validation import FrozenModel, NonEmptyStr
from ..storage.uris import ARTIFACT_ROOT_SCHEMES, normalize_resource_uri


class ExecutionContext(FrozenModel):
    """Runtime identity passed from resolved config into ETL execution."""

    dataset_id: NonEmptyStr
    artifact_root_uri: NonEmptyStr
    frames: tuple[str, ...]

    @field_validator("artifact_root_uri")
    @classmethod
    def _normalize_artifact_root_uri(cls, value: str) -> str:
        try:
            return normalize_resource_uri(value, allowed_schemes=ARTIFACT_ROOT_SCHEMES)
        except SystemExit as exc:
            raise ValueError(str(exc)) from exc

    @field_validator("frames")
    @classmethod
    def _validate_frames(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(validate_frame_id(frame_id) for frame_id in value)


def execution_context(*, dataset_id: str, artifact_root_uri: str, frames: tuple[str, ...]) -> ExecutionContext:
    """Create the runtime identity used by frame jobs and publishers."""

    return ExecutionContext(
        dataset_id=dataset_id,
        artifact_root_uri=artifact_root_uri,
        frames=frames,
    )
