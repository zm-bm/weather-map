"""Runtime request and execution context models."""

from __future__ import annotations

from .config._types import ConfigModel, NonEmptyStr, UniqueNonEmptyStringTuple
from .config.resolved import DatasetConfig


class ExecutionContext(ConfigModel):
    """Runtime identity passed from resolved config into ETL execution."""

    dataset_id: NonEmptyStr
    artifact_root_uri: NonEmptyStr
    frames: UniqueNonEmptyStringTuple


def execution_context_for_dataset(model: DatasetConfig, artifact_root_uri: str) -> ExecutionContext:
    """Create the runtime context used by workers and publishers."""

    return ExecutionContext(
        dataset_id=model.id,
        artifact_root_uri=artifact_root_uri,
        frames=model.workload.frames,
    )
