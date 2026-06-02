"""Workflow logic for scheduled publisher candidates."""

from __future__ import annotations

from dataclasses import dataclass

from ..manifest.publish import PublishResult, run_publish
from ..run_validation import validate_run, validation_report_passed
from ..runtime import execution_context_for_dataset
from .context import ApplicationContext


@dataclass(frozen=True)
class ScheduledPublishResult:
    ready: bool
    run_id: str | None = None
    already_published: bool = False
    latest_promoted: bool = False
    missing_markers: tuple[str, ...] = ()
    not_ready_message: str | None = None
    validation_errors: tuple[str, ...] = ()
    publish_result: PublishResult | None = None


def publish_candidate(
    *,
    app_context: ApplicationContext,
    dataset_id: str,
    cycle: str,
) -> ScheduledPublishResult:
    run_id, run_errors = app_context.select_run_id_for_cycle(
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

    snapshot = app_context.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    cfg = snapshot.loaded_config.config
    model = cfg.dataset(dataset_id)

    validation_passed, validation_errors = validation_report_passed(
        artifact_repo=app_context.artifact_repo,
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
            artifact_repo=app_context.artifact_repo,
            model=model,
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
        ctx=execution_context_for_dataset(model, app_context.artifact_root_uri),
        cycle=cycle,
        run_id=run_id,
        dataset_label=model.label,
        artifact_ids=model.workload.artifacts,
        artifact_specs=model.artifacts,
        artifact_repo=app_context.artifact_repo,
        pipeline_config=cfg,
        forecast_catalog=snapshot.forecast_catalog,
    )
    return ScheduledPublishResult(
        ready=result.ready,
        run_id=run_id,
        already_published=result.already_published,
        latest_promoted=result.latest_promoted,
        missing_markers=tuple(result.missing_markers),
        publish_result=result,
    )
