"""Submit ready ICON DWD frames to Batch."""

from __future__ import annotations

import hashlib
import urllib.error
import urllib.request
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from ..config.pipeline import DatasetConfig
from ..config.sources import ICON_DWD_SOURCE_TYPE
from ..environment import EtlEnvironment
from ..sources.icon.config import IconDwdSourceSettings, parse_icon_dwd_source
from ..sources.icon.dwd import (
    icon_dwd_url,
    previous_icon_frame_id,
    required_icon_params,
    required_previous_icon_params,
)
from ..sources.submission import SourceSubmissionOutcome, SourceSubmissionResult, SourceSubmissionStatus
from ..state.runs.dynamo_coordinator import coordinated_run_id, run_coordinator_ttl_seconds
from ..state.runs.ids import generate_run_id, validate_run_id
from ..workers.backends.aws_batch import launch_aws_batch_plan_workers
from ..workers.claims.dynamo import DynamoFrameClaimStore
from .plan_run import plan_run

DATASET_ID = "icon"
RETRYABLE_HTTP_CODES = {403, 404, 408, 409, 425, 429, 500, 502, 503, 504}


def submit_ready_icon_cycles(
    *,
    batch: Any,
    ddb: Any,
    queue: str,
    job_definition: str,
    frame_claim_table: str,
    run_coordinator_table: str,
    env: EtlEnvironment,
    cycles: tuple[str, ...],
    sentinel_params: tuple[str, ...],
    min_bytes: int,
    now: datetime,
) -> SourceSubmissionResult:
    """Submit ready ICON frame jobs for candidate cycles."""

    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=frame_claim_table)
    outcomes: list[SourceSubmissionOutcome] = []

    for cycle in cycles:
        outcomes.extend(
            _submit_ready_icon_cycle(
                batch=batch,
                ddb=ddb,
                queue=queue,
                job_definition=job_definition,
                run_coordinator_table=run_coordinator_table,
                env=env,
                claim_store=claim_store,
                cycle=cycle,
                sentinel_params=sentinel_params,
                min_bytes=min_bytes,
                now=now,
            )
        )

    return SourceSubmissionResult(outcomes=tuple(outcomes), cycles=len(cycles))


def _submit_ready_icon_cycle(
    *,
    batch: Any,
    ddb: Any,
    queue: str,
    job_definition: str,
    run_coordinator_table: str,
    env: EtlEnvironment,
    claim_store: DynamoFrameClaimStore,
    cycle: str,
    sentinel_params: tuple[str, ...],
    min_bytes: int,
    now: datetime,
) -> tuple[SourceSubmissionOutcome, ...]:
    cycle_run_id = validate_run_id(
        coordinated_run_id(
            ddb=ddb,
            table_name=run_coordinator_table,
            dataset_id=DATASET_ID,
            cycle=cycle,
            now=now,
            new_run_id=generate_run_id(now=now),
            ttl_seconds=run_coordinator_ttl_seconds(),
        )
    )
    snapshot = env.ensure_or_load_run_snapshot(
        dataset_id=DATASET_ID,
        cycle=cycle,
        run_id=cycle_run_id,
    )
    dataset = snapshot.dataset(DATASET_ID)
    if not dataset.workload.artifacts or not dataset.workload.frames:
        print("ICON workload is empty; nothing to submit", flush=True)
        return (
            _cycle_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                status="skipped",
                reason="empty_workload",
            ),
        )

    icon_source = _icon_source_settings(dataset)
    required_params = required_icon_params(dataset)
    previous_required_params = required_previous_icon_params(dataset)

    if not _params_ready(
        base_url=icon_source.normalized_base_url,
        cycle=cycle,
        frame_id="000",
        params=sentinel_params,
        min_bytes=min_bytes,
    ):
        return (
            _cycle_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                status="pending",
                reason="sentinel_not_ready",
            ),
        )

    plan = plan_run(
        env=env,
        dataset_id=DATASET_ID,
        cycle=cycle,
        run_id=cycle_run_id,
        selected_frames=None,
        selected_artifacts=None,
        publish=True,
        claim_store=claim_store,
        now=now,
        loaded_snapshot=snapshot,
    )
    frame_states = {state.frame_id: state for state in plan.frame_states}
    outcomes = [_cycle_outcome(cycle=cycle, run_id=cycle_run_id, status="ready", reason="sentinel_ready")]
    outcomes_by_frame: dict[str, SourceSubmissionOutcome] = {}
    ready_workers = []
    for frame_id in dataset.workload.frames:
        frame_state = frame_states.get(frame_id)
        state = frame_state.state if frame_state is not None else "pending"
        if state == "complete":
            claim_store.record_complete(
                dataset_id=DATASET_ID,
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                now=now,
            )
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="completed",
                reason="complete",
            )
            continue
        if state == "claimed":
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="claimed",
                reason="claimed",
            )
            continue
        if state == "invalid":
            print(f"ICON frame has invalid completion markers: cycle={cycle} frame_id={frame_id}", flush=True)
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="pending",
                reason="invalid_completion_markers",
            )
            continue
        if not _params_ready(
            base_url=icon_source.normalized_base_url,
            cycle=cycle,
            frame_id=frame_id,
            params=required_params,
            min_bytes=min_bytes,
        ):
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="pending",
                reason="current_not_ready",
            )
            continue
        previous_frame_id = previous_icon_frame_id(frame_id)
        if (
            previous_frame_id is not None
            and previous_required_params
            and not _params_ready(
                base_url=icon_source.normalized_base_url,
                cycle=cycle,
                frame_id=previous_frame_id,
                params=previous_required_params,
                min_bytes=min_bytes,
            )
        ):
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="pending",
                reason="previous_not_ready",
            )
            continue
        worker = plan.worker_for_frame(frame_id)
        if worker is None:
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="pending",
                reason="no_worker",
            )
            continue
        ready_workers.append(worker)

    if ready_workers:
        launch_summary = launch_aws_batch_plan_workers(
            plan=plan,
            workers=tuple(ready_workers),
            claim_store=claim_store,
            batch=batch,
            queue=queue,
            job_definition=job_definition,
            job_name_for_worker=lambda current_worker, attempt: _icon_job_name(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=current_worker.frame_id,
                attempt=attempt or 1,
            ),
            now=now,
        )
    else:
        launch_summary = None

    for worker in ready_workers:
        if launch_summary is None:
            break
        result = launch_summary.record_for_frame(worker.frame_id)
        if result is None:
            continue
        frame_id = result.worker.frame_id
        if result.claimed:
            outcomes_by_frame[frame_id] = _frame_outcome(
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                status="claimed",
                reason="active_frame_claim",
                job_id=result.job_id,
            )
            continue
        print(
            "submitted ICON job: "
            f"jobName={result.job_name or ''} jobId={result.job_id or ''} "
            f"cycle={cycle} run_id={cycle_run_id} frame_id={frame_id}",
            flush=True,
        )
        outcomes_by_frame[frame_id] = _frame_outcome(
            cycle=cycle,
            run_id=cycle_run_id,
            frame_id=frame_id,
            status="submitted",
            reason="batch_submitted",
            job_id=result.job_id,
            job_name=result.job_name,
        )
    outcomes.extend(outcomes_by_frame[frame_id] for frame_id in dataset.workload.frames)
    return tuple(outcomes)


def _cycle_outcome(
    *,
    cycle: str,
    status: SourceSubmissionStatus,
    reason: str,
    run_id: str | None = None,
) -> SourceSubmissionOutcome:
    return SourceSubmissionOutcome(
        status=status,
        scope="cycle",
        dataset_id=DATASET_ID,
        cycle=cycle,
        run_id=run_id,
        reason=reason,
    )


def _frame_outcome(
    *,
    cycle: str,
    run_id: str,
    frame_id: str,
    status: SourceSubmissionStatus,
    reason: str,
    job_id: str | None = None,
    job_name: str | None = None,
) -> SourceSubmissionOutcome:
    return SourceSubmissionOutcome(
        status=status,
        scope="frame",
        dataset_id=DATASET_ID,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id,
        reason=reason,
        job_id=job_id,
        job_name=job_name,
    )


def _icon_source_settings(dataset: DatasetConfig) -> IconDwdSourceSettings:
    source = dataset.source
    if source.type != ICON_DWD_SOURCE_TYPE:
        raise SystemExit(f"Dataset {dataset.id!r} is not configured for ICON DWD acquisition")
    return parse_icon_dwd_source(source)


def _params_ready(*, base_url: str, cycle: str, frame_id: str, params: Iterable[str], min_bytes: int) -> bool:
    for param in params:
        url = icon_dwd_url(
            base_url=base_url,
            cycle=cycle,
            frame_id=frame_id,
            icon_param=param,
        )
        if not _url_ready(url, min_bytes=min_bytes):
            print(f"ICON source not ready: cycle={cycle} frame_id={frame_id} param={param}", flush=True)
            return False
    return True


def _icon_job_name(*, cycle: str, run_id: str, frame_id: str, attempt: int) -> str:
    suffix = hashlib.sha1(f"{cycle}:{run_id}:{frame_id}:{attempt}".encode("utf-8")).hexdigest()[:8]
    return f"icon-{cycle}-{run_id}-{frame_id}-{suffix}"[:128]


def _url_ready(url: str, *, min_bytes: int) -> bool:
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "weather-map-etl/1.0"})
    try:
        response_context = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as exc:
        if exc.code in RETRYABLE_HTTP_CODES:
            return False
        raise
    except urllib.error.URLError:
        return False

    with response_context as response:
        status = int(getattr(response, "status", 200))
        if status in RETRYABLE_HTTP_CODES:
            return False
        if status != 200:
            return False
        content_length = response.headers.get("Content-Length")
        if content_length is None:
            return True
        try:
            return int(content_length) >= min_bytes
        except ValueError:
            return True
