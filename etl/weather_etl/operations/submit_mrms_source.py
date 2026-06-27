"""Submit MRMS source notifications to Batch timestamp jobs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ..environment import EtlEnvironment
from ..sources.mrms.config import parse_mrms_aws_s3_source
from ..sources.mrms.layout import (
    mrms_product_uri_from_collection,
    parse_mrms_s3_key,
)
from ..sources.mrms.products import MRMS_PRODUCTS
from ..sources.submission import (
    SourceSubmissionOutcome,
    SourceSubmissionResult,
    SourceSubmissionScope,
    SourceSubmissionStatus,
)
from ..workers.backends.aws_batch import launch_aws_batch_plan_workers
from ..workers.claims.dynamo import DynamoFrameClaimStore
from .plan_run import plan_run
from .run_layouts.base import RunTarget
from .run_layouts.observed_single_frame import (
    ensure_run_snapshot as ensure_observed_frame_run_snapshot,
)
from .run_layouts.observed_single_frame import (
    observed_job_name_for_target,
    run_target_for_observed_frame,
)

DATASET_ID = "mrms"


@dataclass(frozen=True)
class MrmsSourceObject:
    """One S3 object notification from the MRMS AWS Open Data bucket."""

    bucket: str
    key: str

    @property
    def source_uri(self) -> str:
        return f"s3://{self.bucket}/{self.key}"


def _target_frame_id(target: RunTarget) -> str:
    frames = tuple(target.plan_frames or ())
    if len(frames) != 1:
        raise SystemExit(f"Observed source submission requires exactly one plan frame: {target}")
    return frames[0]


def submit_mrms_source_object(
    *,
    batch: Any,
    ddb: Any,
    queue: str,
    job_definition: str,
    frame_claim_table: str,
    env: EtlEnvironment,
    source_object: MrmsSourceObject,
    now: datetime | None = None,
) -> SourceSubmissionResult:
    """Submit one Batch worker once the configured MRMS product exists for a timestamp."""

    product_config = env.load_product_config()
    source_dataset = product_config.dataset(DATASET_ID)
    source = parse_mrms_aws_s3_source(source_dataset.source)
    candidate = _MrmsObjectCandidate.from_source_object(
        source_object,
        collection_uri=source.collection_uri,
        source_bucket=source.normalized_bucket,
        source_prefix=source.normalized_prefix,
    )
    if candidate is None:
        print(f"skip MRMS key (filter): bucket={source_object.bucket} key={source_object.key}")
        return _result(
            status="skipped",
            scope="object",
            source_object=source_object,
            reason="key_filter",
        )

    target = run_target_for_observed_frame(
        product_config=product_config,
        dataset_id=DATASET_ID,
        frame_id=candidate.frame_id,
    )
    frame_id = _target_frame_id(target)
    job_name = observed_job_name_for_target(target)

    missing_product_uris = tuple(
        uri for uri in candidate.required_product_uris
        if not env.store.exists(uri=uri)
    )
    if missing_product_uris:
        print(
            f"pending MRMS timestamp: frame_id={frame_id} "
            f"missing_products={len(missing_product_uris)} key={candidate.key}",
            flush=True,
        )
        return _candidate_result(
            candidate,
            cycle=target.cycle,
            status="pending",
            scope="frame",
            reason="waiting_for_required_product",
            frame_id=frame_id,
            cycles=1,
        )

    effective_now = now or datetime.now(timezone.utc)
    snapshot = ensure_observed_frame_run_snapshot(
        env=env,
        product_config=product_config,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        selected_frames=target.snapshot_frames,
    )
    dataset = snapshot.dataset(target.dataset_id)
    if not dataset.workload.artifacts:
        print(f"skip MRMS key (no workload.artifacts configured): key={candidate.key}")
        return _candidate_result(
            candidate,
            cycle=target.cycle,
            status="skipped",
            scope="cycle",
            run_id=target.run_id,
            reason="empty_workload",
            frame_id=frame_id,
            cycles=1,
        )

    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=frame_claim_table)
    plan = plan_run(
        env=env,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        selected_frames=target.plan_frames,
        selected_artifacts=None,
        publish=True,
        claim_store=claim_store,
        now=effective_now,
        loaded_snapshot=snapshot,
    )
    worker = plan.worker_for_frame(frame_id)
    if worker is None:
        state = plan.frame_states[0].state if plan.frame_states else "unknown"
        if state == "complete":
            claim_store.record_complete(
                dataset_id=target.dataset_id,
                cycle=target.cycle,
                run_id=target.run_id,
                frame_id=frame_id,
                now=effective_now,
            )
        print(f"skip MRMS key (frame state): frame_id={frame_id} state={state} key={candidate.key}")
        return _candidate_result(
            candidate,
            cycle=target.cycle,
            status=_frame_state_status(state),
            scope="frame",
            run_id=target.run_id,
            reason=f"frame_state:{state}",
            frame_id=frame_id,
            cycles=1,
        )

    launch_summary = launch_aws_batch_plan_workers(
        plan=plan,
        workers=(worker,),
        claim_store=claim_store,
        batch=batch,
        queue=queue,
        job_definition=job_definition,
        job_name_for_worker=lambda _worker, _attempt: job_name,
        now=effective_now,
    )
    result = launch_summary.records[0]
    if result.claimed:
        print(f"skip MRMS key (active frame claim): frame_id={frame_id} key={candidate.key}")
        return _candidate_result(
            candidate,
            cycle=target.cycle,
            status="claimed",
            scope="frame",
            run_id=target.run_id,
            reason="active_frame_claim",
            frame_id=frame_id,
            job_id=result.job_id,
            cycles=1,
        )

    print(f"submitted MRMS: {result.job_name or ''} key={candidate.key} run_id={target.run_id}")
    return _candidate_result(
        candidate,
        cycle=target.cycle,
        status="submitted",
        scope="frame",
        run_id=target.run_id,
        reason="batch_submitted",
        frame_id=frame_id,
        job_id=result.job_id,
        job_name=result.job_name,
        cycles=1,
    )


@dataclass(frozen=True)
class _MrmsObjectCandidate:
    source_object: MrmsSourceObject
    frame_id: str
    collection_uri: str

    @classmethod
    def from_source_object(
        cls,
        source_object: MrmsSourceObject,
        *,
        collection_uri: str,
        source_bucket: str,
        source_prefix: str,
    ) -> "_MrmsObjectCandidate | None":
        if source_object.bucket != source_bucket:
            return None
        parsed = parse_mrms_s3_key(source_object.key, expected_prefix=source_prefix)
        if parsed is None:
            return None
        return cls(
            source_object=source_object,
            frame_id=parsed.frame_id,
            collection_uri=collection_uri,
        )

    @property
    def key(self) -> str:
        return self.source_object.key

    @property
    def required_product_uris(self) -> tuple[str, ...]:
        return tuple(
            mrms_product_uri_from_collection(
                collection_uri=self.collection_uri,
                product=product,
                frame_id=self.frame_id,
            )
            for product in MRMS_PRODUCTS
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
    candidate: _MrmsObjectCandidate,
    *,
    cycle: str,
    status: SourceSubmissionStatus,
    scope: SourceSubmissionScope,
    reason: str,
    run_id: str | None = None,
    frame_id: str | None = None,
    job_id: str | None = None,
    job_name: str | None = None,
    cycles: int = 0,
) -> SourceSubmissionResult:
    return _result(
        status=status,
        scope=scope,
        source_object=candidate.source_object,
        cycle=cycle,
        run_id=run_id,
        frame_id=frame_id or candidate.frame_id,
        reason=reason,
        job_id=job_id,
        job_name=job_name,
        cycles=cycles,
    )


def _result(
    *,
    status: SourceSubmissionStatus,
    scope: SourceSubmissionScope,
    source_object: MrmsSourceObject,
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
