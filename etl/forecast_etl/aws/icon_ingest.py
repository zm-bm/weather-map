"""AWS Lambda poller for submitting ICON DWD Batch jobs."""

from __future__ import annotations

import hashlib
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Iterable

import boto3  # type: ignore

from ..config.resolved import DatasetConfig, IconDwdSourceConfig
from ..cycles import latest_synoptic_cycles
from ..frame_claims import DynamoFrameClaimStore
from ..source_adapters.icon_dwd import (
    icon_dwd_url,
    previous_icon_frame_id,
    required_icon_params,
    required_previous_icon_params,
)
from ..storage.routing import make_store
from ..uris import default_forecast_catalog_uri, default_pipeline_config_uri
from ..workflows.context import ApplicationContext
from ..workflows.cycle import check_backfill
from ..workflows.planning import plan_cycle
from .run_coordinator import coordinated_run_id, run_coordinator_ttl_seconds

DEFAULT_PIPELINE_CONFIG_URI = default_pipeline_config_uri()
DEFAULT_FORECAST_CATALOG_URI = default_forecast_catalog_uri()
DEFAULT_POLL_CYCLE_COUNT = 1
DEFAULT_READY_MIN_BYTES = 1024
DATASET_ID = "icon"
DEFAULT_SENTINEL_PARAMS = ("t_2m", "u_10m", "v_10m", "pmsl", "clct")
RETRYABLE_HTTP_CODES = {403, 404, 408, 409, 425, 429, 500, 502, 503, 504}


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
        text = raw.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _candidate_cycles(*, now: datetime, cycle_count: int) -> tuple[str, ...]:
    """Return the latest synoptic cycles newest first."""

    return latest_synoptic_cycles(now=now, count=cycle_count)


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


def _params_ready(*, dataset: DatasetConfig, cycle: str, frame_id: str, params: Iterable[str], min_bytes: int) -> bool:
    source = dataset.source
    if not isinstance(source, IconDwdSourceConfig):
        raise SystemExit(f"Dataset {dataset.id!r} is not configured for ICON DWD acquisition")

    for param in params:
        url = icon_dwd_url(
            base_url=source.icon_dwd.base_url,
            cycle=cycle,
            frame_id=frame_id,
            icon_param=param,
        )
        if not _url_ready(url, min_bytes=min_bytes):
            print(f"ICON source not ready: cycle={cycle} frame_id={frame_id} param={param}", flush=True)
            return False
    return True


def _submit_job(
    *,
    batch,
    queue: str,
    job_definition: str,
    worker_env: dict[str, str],
    cycle: str,
    run_id: str,
    frame_id: str,
    attempt: int,
) -> str:
    suffix = hashlib.sha1(f"{cycle}:{run_id}:{frame_id}:{attempt}".encode("utf-8")).hexdigest()[:8]
    job_name = f"icon-{cycle}-{run_id}-{frame_id}-{suffix}"[:128]
    env_vars = [{"name": name, "value": value} for name, value in worker_env.items()]
    response = batch.submit_job(
        jobName=job_name,
        jobQueue=queue,
        jobDefinition=job_definition,
        containerOverrides={"environment": env_vars},
    ) or {}
    job_id = str(response.get("jobId", ""))
    print(
        f"submitted ICON job: jobName={job_name} jobId={job_id} cycle={cycle} run_id={run_id} frame_id={frame_id}",
        flush=True,
    )
    return job_id


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Poll DWD for ready ICON files and submit Batch jobs."""

    del context
    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
    frame_claim_table = os.environ["FRAME_CLAIM_TABLE"]
    run_coordinator_table = os.environ["RUN_COORDINATOR_TABLE"]
    artifact_root_uri = os.environ["ARTIFACT_ROOT_URI"]
    pipeline_config_uri = os.environ.get("PIPELINE_CONFIG_URI", DEFAULT_PIPELINE_CONFIG_URI).strip()
    forecast_catalog_uri = os.environ.get("FORECAST_CATALOG_URI", DEFAULT_FORECAST_CATALOG_URI).strip()

    now = _event_now(event)
    cycles = _candidate_cycles(
        now=now,
        cycle_count=_positive_int_env("ICON_POLL_CYCLE_COUNT", DEFAULT_POLL_CYCLE_COUNT),
    )
    sentinel_params = _sentinel_params()
    min_bytes = _int_env("ICON_READY_MIN_BYTES", DEFAULT_READY_MIN_BYTES)

    batch = boto3.client("batch")
    ddb = boto3.client("dynamodb")
    store = make_store()
    app_context = ApplicationContext(
        artifact_root_uri=artifact_root_uri,
        pipeline_config_uri=pipeline_config_uri,
        forecast_catalog_uri=forecast_catalog_uri,
        store=store,
    )
    claim_store = DynamoFrameClaimStore(ddb=ddb, table_name=frame_claim_table)

    submitted = 0
    completed = 0
    pending = 0
    claimed = 0
    skipped_cycles = 0

    for cycle in cycles:
        backfill = check_backfill(
            app_context=app_context,
            dataset_id=DATASET_ID,
            cycle=cycle,
        )
        if not backfill.ok:
            print(f"skip ICON cycle (backfill safety): {backfill.message}", flush=True)
            skipped_cycles += 1
            continue

        cycle_run_id = coordinated_run_id(
            ddb=ddb,
            table_name=run_coordinator_table,
            dataset_id=DATASET_ID,
            cycle=cycle,
            now=now,
            ttl_seconds=run_coordinator_ttl_seconds(),
        )
        snapshot = app_context.ensure_or_load_run_snapshot(
            dataset_id=DATASET_ID,
            cycle=cycle,
            run_id=cycle_run_id,
        )
        dataset = snapshot.loaded_config.config.dataset(DATASET_ID)
        if not dataset.workload.artifacts or not dataset.workload.frames:
            print("ICON workload is empty; nothing to submit", flush=True)
            skipped_cycles += 1
            continue
        required_params = required_icon_params(dataset)
        previous_required_params = required_previous_icon_params(dataset)

        if not _params_ready(dataset=dataset, cycle=cycle, frame_id="000", params=sentinel_params, min_bytes=min_bytes):
            skipped_cycles += 1
            continue

        plan = plan_cycle(
            app_context=app_context,
            dataset_id=DATASET_ID,
            cycle=cycle,
            run_id=cycle_run_id,
            selected_frames=None,
            selected_artifacts=None,
            publish=True,
            claim_store=claim_store,
            now=now,
            loaded_snapshot=snapshot,
        ).plan
        frame_states = {str(frame["frame_id"]): frame for frame in plan["frame_states"]}
        workers_by_frame = {str(worker["frame_id"]): worker for worker in plan["workers"]}
        for frame_id in dataset.workload.frames:
            state = str(frame_states.get(frame_id, {}).get("state", "pending"))
            if state == "complete":
                claim_store.record_complete(
                    dataset_id=DATASET_ID,
                    cycle=cycle,
                    run_id=cycle_run_id,
                    frame_id=frame_id,
                    now=now,
                )
                completed += 1
                continue
            if state == "claimed":
                claimed += 1
                continue
            if state == "invalid":
                print(f"ICON frame has invalid marker evidence: cycle={cycle} frame_id={frame_id}", flush=True)
                pending += 1
                continue

            if not _params_ready(dataset=dataset, cycle=cycle, frame_id=frame_id, params=required_params, min_bytes=min_bytes):
                pending += 1
                continue
            previous_frame_id = previous_icon_frame_id(frame_id)
            if (
                previous_frame_id is not None
                and previous_required_params
                and not _params_ready(
                    dataset=dataset,
                    cycle=cycle,
                    frame_id=previous_frame_id,
                    params=previous_required_params,
                    min_bytes=min_bytes,
                )
            ):
                pending += 1
                continue

            worker = workers_by_frame.get(frame_id)
            if worker is None:
                pending += 1
                continue
            claim = claim_store.acquire(
                dataset_id=DATASET_ID,
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                artifact_ids=tuple(plan["artifact_ids"]),
                worker_spec_hash=str(worker["worker_spec_hash"]),
                source_uri=None,
                now=now,
            )
            if not claim.acquired:
                claimed += 1
                continue

            job_id = _submit_job(
                batch=batch,
                queue=queue,
                job_definition=job_definition,
                worker_env=dict(worker["env"]),
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                attempt=claim.attempt or 1,
            )
            claim_store.record_submission(
                dataset_id=DATASET_ID,
                cycle=cycle,
                run_id=cycle_run_id,
                frame_id=frame_id,
                job_id=job_id,
                now=now,
            )
            submitted += 1

    return {
        "ok": True,
        "submitted": submitted,
        "completed": completed,
        "pending": pending,
        "claimed": claimed,
        "skipped_cycles": skipped_cycles,
        "cycles": len(cycles),
    }
