"""Publish processed dataset cycles."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..environment.context import execution_context
from ..state.manifest.publish import PublishResult, run_publish
from ..state.runs.ids import parse_run_id
from ..state.runs.snapshots import select_run_id_for_cycle
from ..state.runs.validation import validate_run, validation_report_passed
from .refresh_status import refresh_status


@dataclass(frozen=True)
class PublishCycleResult:
    ready: bool
    run_id: str | None
    message: str | None = None
    errors: tuple[str, ...] = ()
    publish_result: PublishResult | None = None


@dataclass(frozen=True)
class ScheduledPublishResult:
    ready: bool
    run_id: str | None = None
    not_ready_message: str | None = None
    validation_errors: tuple[str, ...] = ()
    publish_result: PublishResult | None = None

    @property
    def outcome(self) -> Literal["not_ready", "already_published", "published"]:
        if self.publish_result is None:
            return "not_ready"
        return self.publish_result.outcome

    @property
    def already_published(self) -> bool:
        return self.outcome == "already_published"

    @property
    def latest_promoted(self) -> bool:
        return bool(self.publish_result and self.publish_result.latest_promoted)

    @property
    def missing_markers(self) -> tuple[str, ...]:
        if self.publish_result is None:
            return ()
        return tuple(self.publish_result.missing_markers)


def publish_cycle(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None = None,
) -> PublishCycleResult:
    parse_cycle(cycle)
    parsed_required_run_id = parse_run_id(required_run_id) if required_run_id else None
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=env.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=parsed_required_run_id,
    )
    if run_errors or run_id is None:
        return PublishCycleResult(
            ready=False,
            run_id=run_id,
            message=f"run selection failed for dataset_id={dataset_id} cycle={cycle}",
            errors=tuple(run_errors),
        )

    try:
        snapshot = env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except FileNotFoundError as exc:
        return PublishCycleResult(
            ready=False,
            run_id=run_id,
            message=str(exc),
        )

    dataset = snapshot.dataset(dataset_id)
    result = run_publish(
        ctx=execution_context(
            dataset_id=dataset.id,
            artifact_root_uri=env.artifact_root_uri,
            frames=dataset.workload.frames,
        ),
        cycle=cycle,
        run_id=run_id,
        dataset_label=dataset.label,
        artifact_ids=dataset.workload.artifacts,
        artifact_specs=dataset.artifacts,
        artifact_repo=env.artifact_repo,
        product_config=snapshot.product_config,
    )
    refresh_status(env=env)
    return PublishCycleResult(
        ready=result.ready,
        run_id=run_id,
        publish_result=result,
        errors=_publish_result_errors(result),
    )


def publish_candidate(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
) -> ScheduledPublishResult:
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=env.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=None,
    )
    if run_errors or run_id is None:
        return ScheduledPublishResult(
            ready=False,
            run_id=run_id,
            not_ready_message="; ".join(run_errors or ["no run selected"]),
        )

    snapshot = env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    dataset = snapshot.dataset(dataset_id)

    validation_passed, validation_errors = validation_report_passed(
        artifact_repo=env.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )
    if not validation_passed:
        print(
            f"Publisher validating dataset_id={dataset_id} cycle={cycle} run_id={run_id}: "
            + "; ".join(validation_errors[:3]),
            flush=True,
        )
        validation = validate_run(
            artifact_repo=env.artifact_repo,
            dataset=dataset,
            cycle=cycle,
            run_id=run_id,
            snapshot=snapshot,
        )
        if not validation.passed:
            print(
                f"Publisher not ready dataset_id={dataset_id} cycle={cycle} validation_errors={len(validation.errors)}",
                flush=True,
            )
            return ScheduledPublishResult(
                ready=False,
                run_id=run_id,
                not_ready_message="validation failed",
                validation_errors=tuple(validation.errors),
            )

    result = run_publish(
        ctx=execution_context(
            dataset_id=dataset.id,
            artifact_root_uri=env.artifact_root_uri,
            frames=dataset.workload.frames,
        ),
        cycle=cycle,
        run_id=run_id,
        dataset_label=dataset.label,
        artifact_ids=dataset.workload.artifacts,
        artifact_specs=dataset.artifacts,
        artifact_repo=env.artifact_repo,
        product_config=snapshot.product_config,
    )
    return ScheduledPublishResult(
        ready=result.ready,
        run_id=run_id,
        publish_result=result,
    )


def _publish_result_errors(result: PublishResult) -> tuple[str, ...]:
    return (
        *result.run_errors,
        *result.validation_errors,
        *result.marker_errors,
        *result.missing_markers,
    )
