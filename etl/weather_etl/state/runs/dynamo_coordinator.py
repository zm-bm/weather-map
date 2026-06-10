"""DynamoDB-backed run id coordinator for automatic ingest."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from ...core.timestamps import as_utc, isoformat_utc

DEFAULT_RUN_COORDINATOR_TTL_SECONDS = 14 * 24 * 60 * 60


def coordinated_run_id(
    *,
    ddb: Any,
    table_name: str,
    dataset_id: str,
    cycle: str,
    now: datetime,
    new_run_id: str,
    ttl_seconds: int = DEFAULT_RUN_COORDINATOR_TTL_SECONDS,
) -> str:
    """Create or reuse one run id for an automatic dataset cycle."""

    created_at = isoformat_utc(now)
    ttl = int(as_utc(now).timestamp()) + max(1, ttl_seconds)
    response = ddb.update_item(
        TableName=table_name,
        Key={"pk": _dynamo_s(run_pk(dataset_id=dataset_id, cycle=cycle))},
        UpdateExpression=(
            "SET dataset_id = if_not_exists(dataset_id, :dataset_id), "
            "#cycle = if_not_exists(#cycle, :cycle), "
            "run_id = if_not_exists(run_id, :run_id), "
            "created_at = if_not_exists(created_at, :created_at), "
            "#ttl = if_not_exists(#ttl, :ttl)"
        ),
        ExpressionAttributeNames={
            "#cycle": "cycle",
            "#ttl": "ttl",
        },
        ExpressionAttributeValues={
            ":dataset_id": _dynamo_s(dataset_id),
            ":cycle": _dynamo_s(cycle),
            ":run_id": _dynamo_s(new_run_id),
            ":created_at": _dynamo_s(created_at),
            ":ttl": _dynamo_n(ttl),
        },
        ReturnValues="ALL_NEW",
    )
    return str(response.get("Attributes", {}).get("run_id", {}).get("S", ""))


def run_coordinator_ttl_seconds() -> int:
    raw = os.environ.get("RUN_COORDINATOR_TTL_SECONDS")
    if raw is None or not raw.strip():
        return DEFAULT_RUN_COORDINATOR_TTL_SECONDS
    try:
        return max(1, int(raw))
    except ValueError as exc:
        raise SystemExit(f"RUN_COORDINATOR_TTL_SECONDS must be an integer, got: {raw!r}") from exc


def run_pk(*, dataset_id: str, cycle: str) -> str:
    return f"{dataset_id}#{cycle}"


def _dynamo_s(value: str) -> dict[str, str]:
    return {"S": value}


def _dynamo_n(value: int) -> dict[str, str]:
    return {"N": str(value)}
