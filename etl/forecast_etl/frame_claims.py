"""Frame submission claim interfaces."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol

DEFAULT_FRAME_CLAIM_SECONDS = 4 * 60 * 60
DEFAULT_FRAME_CLAIM_TTL_SECONDS = 14 * 24 * 60 * 60


@dataclass(frozen=True)
class FrameClaim:
    """One persisted in-flight frame submission claim."""

    dataset_id: str
    cycle: str
    run_id: str
    frame_id: str
    state: str
    attempt: int
    expires_at_epoch: int
    job_id: str | None = None

    @property
    def active(self) -> bool:
        return self.expires_at_epoch > int(datetime.now(timezone.utc).timestamp())


@dataclass(frozen=True)
class FrameClaimResult:
    """Result of trying to acquire a frame submission claim."""

    acquired: bool
    attempt: int | None = None
    existing: FrameClaim | None = None
    reason: str | None = None


class FrameClaimStore(Protocol):
    """Storage-neutral interface for submission throttling claims."""

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        """Return a persisted frame claim, if present."""
        ...

    def acquire(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_ids: tuple[str, ...],
        worker_spec_hash: str,
        source_uri: str | None,
        now: datetime,
    ) -> FrameClaimResult:
        """Conditionally acquire one frame claim."""
        ...

    def record_submission(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        job_id: str,
        now: datetime,
    ) -> None:
        """Record the submitted worker job id for a claimed frame."""
        ...

    def record_complete(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        now: datetime,
    ) -> None:
        """Record marker-derived completion for a frame."""
        ...


class NullFrameClaimStore:
    """No-op claim store for local planning and dry runs."""

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        return None

    def acquire(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_ids: tuple[str, ...],
        worker_spec_hash: str,
        source_uri: str | None,
        now: datetime,
    ) -> FrameClaimResult:
        del dataset_id, cycle, run_id, frame_id, artifact_ids, worker_spec_hash, source_uri, now
        return FrameClaimResult(acquired=True, attempt=1)

    def record_submission(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        job_id: str,
        now: datetime,
    ) -> None:
        del dataset_id, cycle, run_id, frame_id, job_id, now

    def record_complete(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        now: datetime,
    ) -> None:
        del dataset_id, cycle, run_id, frame_id, now


class DynamoFrameClaimStore:
    """DynamoDB implementation of frame submission claims."""

    def __init__(
        self,
        *,
        ddb: Any,
        table_name: str,
        claim_seconds: int | None = None,
        ttl_seconds: int | None = None,
    ) -> None:
        self.ddb = ddb
        self.table_name = table_name
        self.claim_seconds = claim_seconds if claim_seconds is not None else frame_claim_seconds()
        self.ttl_seconds = ttl_seconds if ttl_seconds is not None else frame_claim_ttl_seconds()

    def get(self, *, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> FrameClaim | None:
        response = self.ddb.get_item(
            TableName=self.table_name,
            Key={"pk": _dynamo_s(frame_claim_pk(dataset_id=dataset_id, cycle=cycle, run_id=run_id, frame_id=frame_id))},
        )
        item = response.get("Item")
        return _claim_from_item(item) if isinstance(item, Mapping) else None

    def acquire(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_ids: tuple[str, ...],
        worker_spec_hash: str,
        source_uri: str | None,
        now: datetime,
    ) -> FrameClaimResult:
        now_epoch = int(_utc(now).timestamp())
        expires_at = now_epoch + max(1, self.claim_seconds)
        ttl = now_epoch + max(1, self.ttl_seconds)
        created_at = _iso(_utc(now))
        values = {
            ":dataset_id": _dynamo_s(dataset_id),
            ":cycle": _dynamo_s(cycle),
            ":run_id": _dynamo_s(run_id),
            ":frame_id": _dynamo_s(frame_id),
            ":artifact_ids": _dynamo_s(",".join(artifact_ids)),
            ":worker_spec_hash": _dynamo_s(worker_spec_hash),
            ":created_at": _dynamo_s(created_at),
            ":updated_at": _dynamo_s(created_at),
            ":expires_at_epoch": _dynamo_n(expires_at),
            ":ttl": _dynamo_n(ttl),
            ":zero": _dynamo_n(0),
            ":one": _dynamo_n(1),
            ":claimed": _dynamo_s("claimed"),
            ":now": _dynamo_n(now_epoch),
        }
        update_expression = (
            "SET dataset_id = :dataset_id, #cycle = :cycle, run_id = :run_id, "
            "frame_id = :frame_id, artifact_ids = :artifact_ids, "
            "worker_spec_hash = :worker_spec_hash, #state = :claimed, "
            "created_at = if_not_exists(created_at, :created_at), updated_at = :updated_at, "
            "expires_at_epoch = :expires_at_epoch, #ttl = :ttl, "
            "attempt = if_not_exists(attempt, :zero) + :one"
        )
        if source_uri:
            values[":source_uri"] = _dynamo_s(source_uri)
            update_expression += ", source_uri = :source_uri"
        try:
            response = self.ddb.update_item(
                TableName=self.table_name,
                Key={"pk": _dynamo_s(frame_claim_pk(dataset_id=dataset_id, cycle=cycle, run_id=run_id, frame_id=frame_id))},
                UpdateExpression=update_expression,
                ConditionExpression=(
                    "attribute_not_exists(pk) OR expires_at_epoch < :now OR #state <> :claimed"
                ),
                ExpressionAttributeNames={"#cycle": "cycle", "#state": "state", "#ttl": "ttl"},
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )
        except self.ddb.exceptions.ConditionalCheckFailedException:
            existing = self.get(dataset_id=dataset_id, cycle=cycle, run_id=run_id, frame_id=frame_id)
            return FrameClaimResult(acquired=False, existing=existing, reason="active_claim")

        item = response.get("Attributes", {})
        attempt = int(item.get("attempt", {}).get("N", "1"))
        return FrameClaimResult(acquired=True, attempt=attempt)

    def record_submission(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        job_id: str,
        now: datetime,
    ) -> None:
        self.ddb.update_item(
            TableName=self.table_name,
            Key={"pk": _dynamo_s(frame_claim_pk(dataset_id=dataset_id, cycle=cycle, run_id=run_id, frame_id=frame_id))},
            UpdateExpression="SET job_id = :job_id, updated_at = :updated_at",
            ExpressionAttributeValues={
                ":job_id": _dynamo_s(job_id),
                ":updated_at": _dynamo_s(_iso(_utc(now))),
            },
        )

    def record_complete(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        now: datetime,
    ) -> None:
        now_epoch = int(_utc(now).timestamp())
        self.ddb.update_item(
            TableName=self.table_name,
            Key={"pk": _dynamo_s(frame_claim_pk(dataset_id=dataset_id, cycle=cycle, run_id=run_id, frame_id=frame_id))},
            UpdateExpression=(
                "SET dataset_id = :dataset_id, #cycle = :cycle, run_id = :run_id, "
                "frame_id = :frame_id, #state = :complete, updated_at = :updated_at, #ttl = :ttl"
            ),
            ExpressionAttributeNames={"#cycle": "cycle", "#state": "state", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":dataset_id": _dynamo_s(dataset_id),
                ":cycle": _dynamo_s(cycle),
                ":run_id": _dynamo_s(run_id),
                ":frame_id": _dynamo_s(frame_id),
                ":complete": _dynamo_s("complete"),
                ":updated_at": _dynamo_s(_iso(_utc(now))),
                ":ttl": _dynamo_n(now_epoch + max(1, self.ttl_seconds)),
            },
        )


def frame_claim_pk(*, dataset_id: str, cycle: str, run_id: str, frame_id: str) -> str:
    return f"{dataset_id}#{cycle}#{run_id}#{frame_id}"


def worker_spec_hash(worker: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(worker, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def frame_claim_seconds() -> int:
    return _positive_int_env("FRAME_CLAIM_SECONDS", DEFAULT_FRAME_CLAIM_SECONDS)


def frame_claim_ttl_seconds() -> int:
    return _positive_int_env("FRAME_CLAIM_TTL_SECONDS", DEFAULT_FRAME_CLAIM_TTL_SECONDS)


def _positive_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return max(1, int(raw))
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer, got: {raw!r}") from exc


def _claim_from_item(item: Mapping[str, Any]) -> FrameClaim:
    return FrameClaim(
        dataset_id=str(item.get("dataset_id", {}).get("S", "")),
        cycle=str(item.get("cycle", {}).get("S", "")),
        run_id=str(item.get("run_id", {}).get("S", "")),
        frame_id=str(item.get("frame_id", {}).get("S", "")),
        state=str(item.get("state", {}).get("S", "")),
        attempt=int(item.get("attempt", {}).get("N", "0")),
        expires_at_epoch=int(item.get("expires_at_epoch", {}).get("N", "0")),
        job_id=(str(item["job_id"]["S"]) if isinstance(item.get("job_id"), Mapping) else None),
    )


def _dynamo_s(value: str) -> dict[str, str]:
    return {"S": value}


def _dynamo_n(value: int) -> dict[str, str]:
    return {"N": str(value)}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")
