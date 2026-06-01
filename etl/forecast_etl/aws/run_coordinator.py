"""DynamoDB-backed run id coordinator for automatic ingest."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from ..run_ids import generate_run_id, validate_run_id

DEFAULT_RUN_COORDINATOR_TTL_SECONDS = 14 * 24 * 60 * 60


def coordinated_run_id(
    *,
    ddb: Any,
    table_name: str,
    model_id: str,
    cycle: str,
    now: datetime,
    ttl_seconds: int = DEFAULT_RUN_COORDINATOR_TTL_SECONDS,
) -> str:
    """Create or reuse one run id for an automatic model cycle."""

    run_id = generate_run_id(now=now)
    created_at = _utc(now).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ttl = int(_utc(now).timestamp()) + max(1, ttl_seconds)
    response = ddb.update_item(
        TableName=table_name,
        Key={"pk": _dynamo_s(run_pk(model_id=model_id, cycle=cycle))},
        UpdateExpression=(
            "SET #model = if_not_exists(#model, :model), "
            "#cycle = if_not_exists(#cycle, :cycle), "
            "runId = if_not_exists(runId, :run_id), "
            "createdAt = if_not_exists(createdAt, :created_at), "
            "#ttl = if_not_exists(#ttl, :ttl)"
        ),
        ExpressionAttributeNames={
            "#model": "model",
            "#cycle": "cycle",
            "#ttl": "ttl",
        },
        ExpressionAttributeValues={
            ":model": _dynamo_s(model_id),
            ":cycle": _dynamo_s(cycle),
            ":run_id": _dynamo_s(run_id),
            ":created_at": _dynamo_s(created_at),
            ":ttl": _dynamo_n(ttl),
        },
        ReturnValues="ALL_NEW",
    )
    stored = str(response.get("Attributes", {}).get("runId", {}).get("S", ""))
    return validate_run_id(stored)


def run_coordinator_ttl_seconds() -> int:
    raw = os.environ.get("RUN_COORDINATOR_TTL_SECONDS")
    if raw is None or not raw.strip():
        return DEFAULT_RUN_COORDINATOR_TTL_SECONDS
    try:
        return max(1, int(raw))
    except ValueError as exc:
        raise SystemExit(f"RUN_COORDINATOR_TTL_SECONDS must be an integer, got: {raw!r}") from exc


def run_pk(*, model_id: str, cycle: str) -> str:
    return f"{model_id}#{cycle}"


def _dynamo_s(value: str) -> dict[str, str]:
    return {"S": value}


def _dynamo_n(value: int) -> dict[str, str]:
    return {"N": str(value)}


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
