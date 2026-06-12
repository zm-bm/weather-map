"""Publish processed runs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ..config.product import LoadedProductConfig
from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..environment.context import execution_context
from ..sources.registry import source_frame_valid_times
from ..state.manifest.public_view import DatasetViewPublishResult, publish_dataset_view
from ..state.manifest.publish import RunManifestPublishResult, publish_run_manifest
from ..state.runs.ids import parse_run_id
from ..state.runs.snapshots import select_run_id_for_cycle
from ..state.runs.validation import validate_run, validation_report_passed
from .refresh_status import refresh_status
from .run_layouts import rolling_scan_anchor


@dataclass(frozen=True)
class PublishRunResult:
    ready: bool
    run_id: str | None
    message: str | None = None
    errors: tuple[str, ...] = ()
    run_publish_result: RunManifestPublishResult | None = None
    view_publish_result: DatasetViewPublishResult | None = None


@dataclass(frozen=True)
class RunCandidatePublishResult:
    ready: bool
    run_id: str | None = None
    not_ready_message: str | None = None
    validation_errors: tuple[str, ...] = ()
    run_publish_result: RunManifestPublishResult | None = None
    product_config: LoadedProductConfig | None = None

    @property
    def outcome(self) -> Literal["not_ready", "already_published", "published"]:
        if self.run_publish_result is None:
            return "not_ready"
        return self.run_publish_result.outcome

    @property
    def already_published(self) -> bool:
        return self.outcome == "already_published"

    @property
    def missing_markers(self) -> tuple[str, ...]:
        if self.run_publish_result is None:
            return ()
        return tuple(self.run_publish_result.missing_markers)


def publish_run(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None = None,
) -> PublishRunResult:
    parse_cycle(cycle)
    parsed_required_run_id = parse_run_id(required_run_id) if required_run_id else None
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=env.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=parsed_required_run_id,
    )
    if run_errors or run_id is None:
        return PublishRunResult(
            ready=False,
            run_id=run_id,
            message=f"run selection failed for dataset_id={dataset_id} cycle={cycle}",
            errors=tuple(run_errors),
        )

    try:
        snapshot = env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except FileNotFoundError as exc:
        return PublishRunResult(
            ready=False,
            run_id=run_id,
            message=str(exc),
        )

    dataset = snapshot.dataset(dataset_id)
    run_result = publish_run_manifest(
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
        frame_valid_times=source_frame_valid_times(dataset, dataset.workload.frames),
    )
    view_result = None
    if run_result.ready:
        try:
            view_result = publish_dataset_view(
                product_config=snapshot.product_config,
                artifact_repo=env.artifact_repo,
                dataset_id=dataset.id,
                cycle=cycle,
                run_id=run_id,
                now=rolling_scan_anchor(product_config=snapshot.product_config, dataset_id=dataset.id),
            )
        except (Exception, SystemExit) as exc:
            view_result = DatasetViewPublishResult(
                ready=False,
                published=False,
                message=str(exc),
                errors=(str(exc),),
            )
    refresh_status(env=env)
    return PublishRunResult(
        ready=run_result.ready and (view_result is None or view_result.ready),
        run_id=run_id,
        run_publish_result=run_result,
        view_publish_result=view_result,
        errors=(*_publish_result_errors(run_result), *(view_result.errors if view_result is not None else ())),
    )


def publish_run_candidate(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None = None,
) -> RunCandidatePublishResult:
    parsed_required_run_id = parse_run_id(required_run_id) if required_run_id else None
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=env.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=parsed_required_run_id,
    )
    if run_errors or run_id is None:
        return RunCandidatePublishResult(
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
            return RunCandidatePublishResult(
                ready=False,
                run_id=run_id,
                not_ready_message="validation failed",
                validation_errors=tuple(validation.errors),
            )

    result = publish_run_manifest(
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
        frame_valid_times=source_frame_valid_times(dataset, dataset.workload.frames),
    )
    return RunCandidatePublishResult(
        ready=result.ready,
        run_id=run_id,
        run_publish_result=result,
        product_config=snapshot.product_config,
    )


def _publish_result_errors(result: RunManifestPublishResult) -> tuple[str, ...]:
    return (
        *result.run_errors,
        *result.validation_errors,
        *result.marker_errors,
        *result.missing_markers,
    )
