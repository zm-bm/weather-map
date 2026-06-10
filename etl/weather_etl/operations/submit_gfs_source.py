"""Submit GFS source notifications to Batch frame jobs."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..config.pipeline import PipelineConfig
from ..environment import EtlEnvironment
from ..sources.submission import (
    SourceSubmissionOutcome,
    SourceSubmissionResult,
    SourceSubmissionScope,
    SourceSubmissionStatus,
)
from ..state.manifest.submission_policy import check_cycle_submission_policy
from ..state.runs.dynamo_coordinator import coordinated_run_id, run_coordinator_ttl_seconds
from ..state.runs.ids import generate_run_id, validate_run_id
from ..workers.backends.aws_batch import launch_aws_batch_plan_workers
from ..workers.claims.dynamo import DynamoFrameClaimStore
from .plan_cycle import plan_cycle

KEY_RE = re.compile(r"^gfs\.(\d{8})/(\d{2})/atmos/gfs\.t\d{2}z\.pgrb2\.0p25\.f(\d{3})$")
ALLOWED_CYCLES = {"00", "06", "12", "18"}
DATASET_ID = "gfs"


@dataclass(frozen=True)
class GfsSourceObject:
    bucket: str
    key: str

    @property
    def source_uri(self) -> str:
        return f"s3://{self.bucket}/{self.key}"


def submit_gfs_source_object(
    *,
    batch: Any,
    ddb: Any,
    queue: str,
    job_definition: str,
    run_coordinator_table: str,
    frame_claim_table: str,
    env: EtlEnvironment,
    source_object: GfsSourceObject,
) -> SourceSubmissionResult:
    """Submit one Batch worker job when the S3 key matches workload filters."""

    candidate = _GfsObjectCandidate.from_source_object(source_object)
    if candidate is None:
        print(f"skip key (filter): {source_object.key}")
        return _result(
            status="skipped",
            scope="object",
            source_object=source_object,
            reason="key_filter",
        )

    if not candidate.is_allowed_cycle:
        print(f"skip key (cycle filter): cycle_hour={candidate.cycle_hour} key={candidate.key}")
        return _candidate_result(candidate, status="skipped", scope="object", reason="cycle_filter")

    submission_decision = check_cycle_submission_policy(
        artifact_repo=env.artifact_repo,
        dataset_id=DATASET_ID,
        cycle=candidate.cycle,
    )
    if not submission_decision.allowed:
        print(f"skip key (submission policy): {submission_decision.message} key={candidate.key}")
        return _candidate_result(candidate, status="blocked", scope="cycle", reason="submission_policy", cycles=1)

    now = datetime.now(timezone.utc)
    run_id = validate_run_id(
        coordinated_run_id(
            ddb=ddb,
            table_name=run_coordinator_table,
            dataset_id=DATASET_ID,
            cycle=candidate.cycle,
            now=now,
            new_run_id=generate_run_id(now=now),
            ttl_seconds=run_coordinator_ttl_seconds(),
        )
    )
    snapshot = env.ensure_or_load_run_snapshot(
        dataset_id=DATASET_ID,
        cycle=candidate.cycle,
        run_id=run_id,
    )
    filters = _filters_from_config(snapshot.pipeline_config)

    if not filters.accepts_frame(candidate.frame_id):
        print(f"skip key (frame filter): frame_id={candidate.frame_id} key={candidate.key}")
        return _candidate_result(
            candidate,
            status="skipped",
            scope="frame",
            run_id=run_id,
            reason="frame_filter",
            cycles=1,
        )

    if not filters.has_work_items:
        print(f"skip key (no workload.artifacts configured): key={candidate.key}")
        return _candidate_result(
            candidate,
            status="skipped",
            scope="cycle",
            run_id=run_id,
            reason="empty_workload",
            cycles=1,
        )

    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=frame_claim_table)
    plan = plan_cycle(
        env=env,
        dataset_id=DATASET_ID,
        cycle=candidate.cycle,
        run_id=run_id,
        selected_frames=(candidate.frame_id,),
        selected_artifacts=None,
        publish=True,
        claim_store=claim_store,
        source_uris_by_frame={candidate.frame_id: candidate.source_uri},
        now=now,
        loaded_snapshot=snapshot,
    )
    worker = plan.worker_for_frame(candidate.frame_id)
    if worker is None:
        state = plan.frame_states[0].state if plan.frame_states else "unknown"
        if state == "complete":
            claim_store.record_complete(
                dataset_id=DATASET_ID,
                cycle=candidate.cycle,
                run_id=run_id,
                frame_id=candidate.frame_id,
                now=now,
            )
        print(f"skip key (frame state): frame_id={candidate.frame_id} state={state} key={candidate.key}")
        return _candidate_result(
            candidate,
            status=_frame_state_status(state),
            scope="frame",
            run_id=run_id,
            reason=f"frame_state:{state}",
            cycles=1,
        )

    launch_summary = launch_aws_batch_plan_workers(
        plan=plan,
        workers=(worker,),
        claim_store=claim_store,
        batch=batch,
        queue=queue,
        job_definition=job_definition,
        job_name_for_worker=lambda _worker, _attempt: candidate.job_name(run_id=run_id),
        now=now,
    )
    result = launch_summary.records[0]
    if result.claimed:
        print(f"skip key (active frame claim): frame_id={candidate.frame_id} key={candidate.key}")
        return _candidate_result(
            candidate,
            status="claimed",
            scope="frame",
            run_id=run_id,
            reason="active_frame_claim",
            job_id=result.job_id,
            cycles=1,
        )

    print(
        f"submitted: {result.job_name or ''} key={candidate.key} "
        f"run_id={run_id} artifacts={len(filters.artifacts)}"
    )
    return _candidate_result(
        candidate,
        status="submitted",
        scope="frame",
        run_id=run_id,
        reason="batch_submitted",
        job_id=result.job_id,
        job_name=result.job_name,
        cycles=1,
    )


@dataclass(frozen=True)
class _GfsObjectCandidate:
    source_object: GfsSourceObject
    cycle: str
    cycle_hour: str
    frame_id: str

    @classmethod
    def from_source_object(cls, source_object: GfsSourceObject) -> "_GfsObjectCandidate | None":
        matched = KEY_RE.match(source_object.key)
        if not matched:
            return None
        cycle_date = matched.group(1)
        cycle_hour = matched.group(2)
        return cls(
            source_object=source_object,
            cycle=f"{cycle_date}{cycle_hour}",
            cycle_hour=cycle_hour,
            frame_id=matched.group(3),
        )

    @property
    def key(self) -> str:
        return self.source_object.key

    @property
    def source_uri(self) -> str:
        return self.source_object.source_uri

    @property
    def is_allowed_cycle(self) -> bool:
        return self.cycle_hour in ALLOWED_CYCLES

    def job_name(self, *, run_id: str) -> str:
        suffix = hashlib.sha1(f"{self.cycle}:{run_id}:{self.frame_id}:{self.key}".encode("utf-8")).hexdigest()[:8]
        return f"gfs-{self.cycle}-{run_id}-{self.frame_id}-{suffix}"[:128]


@dataclass(frozen=True)
class _GfsWorkloadFilters:
    artifacts: tuple[str, ...]
    allowed_frames: frozenset[str]

    @property
    def has_work_items(self) -> bool:
        return bool(self.artifacts)

    def accepts_frame(self, frame_id: str) -> bool:
        return not self.allowed_frames or frame_id in self.allowed_frames


def _filters_from_config(cfg: PipelineConfig) -> _GfsWorkloadFilters:
    dataset = cfg.dataset(DATASET_ID)
    return _GfsWorkloadFilters(
        artifacts=tuple(dataset.workload.artifacts),
        allowed_frames=frozenset(dataset.workload.frames),
    )


def _frame_state_status(state: str) -> SourceSubmissionStatus:
    if state == "complete":
        return "completed"
    if state == "claimed":
        return "claimed"
    if state == "invalid":
        return "blocked"
    return "pending"


def _candidate_result(
    candidate: _GfsObjectCandidate,
    *,
    status: SourceSubmissionStatus,
    scope: SourceSubmissionScope,
    reason: str,
    run_id: str | None = None,
    job_id: str | None = None,
    job_name: str | None = None,
    cycles: int = 0,
) -> SourceSubmissionResult:
    return _result(
        status=status,
        scope=scope,
        source_object=candidate.source_object,
        cycle=candidate.cycle,
        run_id=run_id,
        frame_id=candidate.frame_id,
        reason=reason,
        job_id=job_id,
        job_name=job_name,
        cycles=cycles,
    )


def _result(
    *,
    status: SourceSubmissionStatus,
    scope: SourceSubmissionScope,
    source_object: GfsSourceObject,
    reason: str,
    cycle: str | None = None,
    run_id: str | None = None,
    frame_id: str | None = None,
    job_id: str | None = None,
    job_name: str | None = None,
    cycles: int = 0,
) -> SourceSubmissionResult:
    return SourceSubmissionResult.from_outcomes(
        SourceSubmissionOutcome(
            status=status,
            scope=scope,
            dataset_id=DATASET_ID,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            source_uri=source_object.source_uri,
            source_key=source_object.key,
            reason=reason,
            job_id=job_id,
            job_name=job_name,
        ),
        cycles=cycles,
    )
