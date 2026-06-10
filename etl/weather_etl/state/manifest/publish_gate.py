"""Publish input resolution and validation-report gate."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from ...environment.context import ExecutionContext
from ..artifacts.repository import ArtifactRepository
from ..runs.snapshots import select_run_id_for_cycle
from ..runs.validation import validation_report_passed


@dataclass(frozen=True)
class PublishGateResult:
    """Resolved publish inputs after pre-publication gate checks."""

    ready: bool
    frames: tuple[str, ...] = ()
    artifact_ids: tuple[str, ...] = ()
    run_id: str | None = None
    run_errors: tuple[str, ...] = ()
    validation_errors: tuple[str, ...] = ()


def check_publish_gate(
    *,
    ctx: ExecutionContext,
    cycle: str,
    run_id: str | None,
    artifact_ids: Iterable[str],
    artifact_repo: ArtifactRepository,
) -> PublishGateResult:
    """Resolve selected run inputs and enforce the validation gate."""

    frames = tuple(ctx.frames or ())
    resolved_artifact_ids = tuple(artifact_ids)

    if not frames:
        print("Publish not ready: ctx.frames is empty")
        return PublishGateResult(ready=False)

    if not resolved_artifact_ids:
        print("Publish not ready: workload.artifacts is empty")
        return PublishGateResult(ready=False, frames=frames)

    resolved_run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        required_run_id=run_id,
    )
    if run_errors:
        print(f"Publish not ready: run selection failed for dataset_id={ctx.dataset_id} cycle={cycle}")
        for error in run_errors[:10]:
            print(f"run error: {error}")
        if len(run_errors) > 10:
            print(f"... and {len(run_errors) - 10} more")
        return PublishGateResult(
            ready=False,
            frames=frames,
            artifact_ids=resolved_artifact_ids,
            run_id=resolved_run_id,
            run_errors=tuple(run_errors),
        )
    if resolved_run_id is None:
        print("Publish not ready: no run found")
        return PublishGateResult(ready=False, frames=frames, artifact_ids=resolved_artifact_ids)

    validation_passed, validation_errors = validation_report_passed(
        artifact_repo=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
    )
    if not validation_passed:
        print(
            f"Publish not ready: validation has not passed for "
            f"dataset_id={ctx.dataset_id} cycle={cycle} run_id={resolved_run_id}"
        )
        for error in validation_errors[:10]:
            print(f"validation error: {error}")
        if len(validation_errors) > 10:
            print(f"... and {len(validation_errors) - 10} more")
        return PublishGateResult(
            ready=False,
            frames=frames,
            artifact_ids=resolved_artifact_ids,
            run_id=resolved_run_id,
            validation_errors=tuple(validation_errors),
        )

    return PublishGateResult(
        ready=True,
        frames=frames,
        artifact_ids=resolved_artifact_ids,
        run_id=resolved_run_id,
    )
