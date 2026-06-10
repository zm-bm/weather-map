"""AWS Lambda poller for submitting ICON DWD Batch jobs."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import boto3  # type: ignore

from ...core.cycles import latest_synoptic_cycles
from ...core.timestamps import parse_iso_datetime_utc
from ...environment import EtlEnvironment
from ...operations.submit_icon_ready import submit_ready_icon_cycles
from ...storage.routing import make_store
from ...storage.uris import default_catalog_uri, default_pipeline_uri

DEFAULT_PIPELINE_URI = default_pipeline_uri()
DEFAULT_CATALOG_URI = default_catalog_uri()
DEFAULT_POLL_CYCLE_COUNT = 1
DEFAULT_READY_MIN_BYTES = 1024
DEFAULT_SENTINEL_PARAMS = ("t_2m", "u_10m", "v_10m", "pmsl", "clct")


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer, got: {raw!r}") from exc
    return max(0, value)


def _positive_int_env(name: str, default: int) -> int:
    return max(1, _int_env(name, default))


def _sentinel_params() -> tuple[str, ...]:
    raw = os.environ.get("ICON_SENTINEL_PARAMS", "")
    if not raw.strip():
        return DEFAULT_SENTINEL_PARAMS
    params = tuple(part.strip().lower() for part in raw.replace(",", " ").split() if part.strip())
    if not params:
        raise SystemExit("ICON_SENTINEL_PARAMS did not contain any parameter names")
    return params


def _event_now(event: dict[str, Any]) -> datetime:
    raw = event.get("time") or os.environ.get("ICON_POLL_NOW")
    if isinstance(raw, str) and raw.strip():
        return parse_iso_datetime_utc(raw)
    return datetime.now(timezone.utc)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Poll DWD for ready ICON files and submit Batch jobs."""

    del context
    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
    frame_claim_table = os.environ["FRAME_CLAIM_TABLE"]
    run_coordinator_table = os.environ["RUN_COORDINATOR_TABLE"]
    artifact_root_uri = os.environ["ARTIFACT_ROOT_URI"]
    pipeline_uri = os.environ.get("PIPELINE_URI", DEFAULT_PIPELINE_URI).strip()
    catalog_uri = os.environ.get("CATALOG_URI", DEFAULT_CATALOG_URI).strip()

    now = _event_now(event)
    cycles = latest_synoptic_cycles(
        now=now,
        count=_positive_int_env("ICON_POLL_CYCLE_COUNT", DEFAULT_POLL_CYCLE_COUNT),
    )
    sentinel_params = _sentinel_params()
    min_bytes = _int_env("ICON_READY_MIN_BYTES", DEFAULT_READY_MIN_BYTES)

    batch = boto3.client("batch")
    ddb = boto3.client("dynamodb")
    store = make_store()
    env = EtlEnvironment(
        artifact_root_uri=artifact_root_uri,
        pipeline_uri=pipeline_uri,
        catalog_uri=catalog_uri,
        store=store,
    )
    result = submit_ready_icon_cycles(
        batch=batch,
        ddb=ddb,
        queue=queue,
        job_definition=job_definition,
        frame_claim_table=frame_claim_table,
        run_coordinator_table=run_coordinator_table,
        env=env,
        cycles=cycles,
        sentinel_params=sentinel_params,
        min_bytes=min_bytes,
        now=now,
    )
    return {
        "ok": True,
        "submitted": result.submitted,
        "completed": result.completed,
        "pending": result.pending_frames,
        "claimed": result.claimed,
        "skipped_cycles": result.skipped_cycles,
        "cycles": result.cycles,
    }
