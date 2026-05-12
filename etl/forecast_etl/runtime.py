"""Runtime request and execution context models."""

from __future__ import annotations

from .config._types import ConfigModel, NonEmptyStr, UniqueNonEmptyStringTuple
from .config.resolved import ModelConfig


class ExecutionContext(ConfigModel):
    """Runtime identity passed from resolved config into ETL execution."""

    model_id: NonEmptyStr
    artifact_root_uri: NonEmptyStr
    forecast_hours: UniqueNonEmptyStringTuple


def execution_context_for_model(model: ModelConfig, artifact_root_uri: str) -> ExecutionContext:
    """Create the runtime context used by workers and publishers."""

    return ExecutionContext(
        model_id=model.id,
        artifact_root_uri=artifact_root_uri,
        forecast_hours=model.workload.forecast_hours,
    )
