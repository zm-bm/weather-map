"""AWS Lambda poller for submitting ICON DWD Batch jobs."""

from __future__ import annotations

import hashlib
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Iterable

import boto3  # type: ignore

from ..artifacts.paths import ArtifactPaths
from ..artifacts.repository import ArtifactRepository
from ..config.load import load_pipeline_config
from ..config.resolved import IconDwdSourceConfig, ModelConfig, PipelineConfig
from ..cycles import latest_synoptic_cycles
from ..source_adapters.icon_dwd import (
    icon_dwd_url,
    previous_icon_fhour,
    required_icon_params,
    required_previous_icon_params,
)
from ..storage.base import UriStore
from ..storage.routing import make_store
from ..uris import default_pipeline_config_uri
from .run_coordinator import coordinated_run_id, run_coordinator_ttl_seconds

DEFAULT_PIPELINE_CONFIG_URI = default_pipeline_config_uri()
DEFAULT_POLL_CYCLE_COUNT = 1
DEFAULT_LEASE_SECONDS = 14400
DEFAULT_STATE_TTL_SECONDS = 14 * 24 * 60 * 60
DEFAULT_READY_MIN_BYTES = 1024
MODEL_ID = "icon"
DEFAULT_SENTINEL_PARAMS = ("t_2m", "u_10m", "v_10m", "pmsl", "clct")
RETRYABLE_HTTP_CODES = {403, 404, 408, 409, 425, 429, 500, 502, 503, 504}

_CONFIG_CACHE_BY_URI: dict[str, PipelineConfig] = {}


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


def _pipeline_config(pipeline_config_uri: str) -> PipelineConfig:
    cached = _CONFIG_CACHE_BY_URI.get(pipeline_config_uri)
    if cached is not None:
        return cached

    cfg = load_pipeline_config(pipeline_config_uri)
    _CONFIG_CACHE_BY_URI[pipeline_config_uri] = cfg
    print(f"Loaded ICON pipeline config from: {pipeline_config_uri}", flush=True)
    return cfg


def _model(pipeline_config_uri: str) -> ModelConfig:
    cfg = _pipeline_config(pipeline_config_uri)
    model = cfg.model(MODEL_ID)
    return model


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


def _params_ready(*, model: ModelConfig, cycle: str, fhour: str, params: Iterable[str], min_bytes: int) -> bool:
    source = model.source
    if not isinstance(source, IconDwdSourceConfig):
        raise SystemExit(f"Model {model.id!r} is not configured for ICON DWD acquisition")

    for param in params:
        url = icon_dwd_url(
            base_url=source.icon_dwd.base_url,
            cycle=cycle,
            fhour=fhour,
            icon_param=param,
        )
        if not _url_ready(url, min_bytes=min_bytes):
            print(f"ICON source not ready: cycle={cycle} fhour={fhour} param={param}", flush=True)
            return False
    return True


def _existing_success_markers(
    *,
    store: UriStore,
    paths: ArtifactPaths,
    model_id: str,
    cycle: str,
    run_id: str,
) -> set[str]:
    return ArtifactRepository(store=store, paths=paths).list_success_marker_uris(
        model_id=model_id,
        cycle=cycle,
        run_id=run_id,
    )


def _hour_complete(
    *,
    paths: ArtifactPaths,
    existing_markers: set[str],
    model: ModelConfig,
    cycle: str,
    run_id: str,
    fhour: str,
) -> bool:
    return all(
        paths.success_marker_uri_parts(
            model_id=model.id,
            cycle=cycle,
            run_id=run_id,
            fhour=fhour,
            artifact_id=artifact_id,
        )
        in existing_markers
        for artifact_id in model.workload.artifacts
    )


def _lease_pk(*, cycle: str, fhour: str) -> str:
    return f"{MODEL_ID}#{cycle}#{fhour}"


def _dynamo_s(value: str) -> dict[str, str]:
    return {"S": value}


def _dynamo_n(value: int) -> dict[str, str]:
    return {"N": str(value)}


def _try_acquire_lease(*, ddb, table_name: str, cycle: str, fhour: str, now_epoch: int) -> int | None:
    lease_seconds = _int_env("ICON_LEASE_SECONDS", DEFAULT_LEASE_SECONDS)
    ttl_seconds = _int_env("ICON_STATE_TTL_SECONDS", DEFAULT_STATE_TTL_SECONDS)
    try:
        response = ddb.update_item(
            TableName=table_name,
            Key={"pk": _dynamo_s(_lease_pk(cycle=cycle, fhour=fhour))},
            UpdateExpression=(
                "SET #state = :processing, #cycle = :cycle, fhour = :fhour, "
                "lastCheckedAt = :now, leaseUntil = :lease_until, #ttl = :ttl, "
                "attempt = if_not_exists(attempt, :zero) + :one"
            ),
            ConditionExpression="attribute_not_exists(pk) OR leaseUntil < :now OR #state = :complete",
            ExpressionAttributeNames={"#cycle": "cycle", "#state": "state", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":processing": _dynamo_s("processing"),
                ":cycle": _dynamo_s(cycle),
                ":fhour": _dynamo_s(fhour),
                ":now": _dynamo_n(now_epoch),
                ":lease_until": _dynamo_n(now_epoch + lease_seconds),
                ":ttl": _dynamo_n(now_epoch + ttl_seconds),
                ":zero": _dynamo_n(0),
                ":one": _dynamo_n(1),
                ":complete": _dynamo_s("complete"),
            },
            ReturnValues="ALL_NEW",
        )
    except ddb.exceptions.ConditionalCheckFailedException:
        return None

    attempt = response.get("Attributes", {}).get("attempt", {}).get("N", "1")
    return int(attempt)


def _record_submission(*, ddb, table_name: str, cycle: str, fhour: str, job_id: str, now_epoch: int) -> None:
    ddb.update_item(
        TableName=table_name,
        Key={"pk": _dynamo_s(_lease_pk(cycle=cycle, fhour=fhour))},
        UpdateExpression="SET #state = :submitted, jobId = :job_id, submittedAt = :now",
        ExpressionAttributeNames={"#state": "state"},
        ExpressionAttributeValues={
            ":submitted": _dynamo_s("submitted"),
            ":job_id": _dynamo_s(job_id),
            ":now": _dynamo_n(now_epoch),
        },
    )


def _mark_complete(*, ddb, table_name: str, cycle: str, fhour: str, now_epoch: int) -> None:
    ttl_seconds = _int_env("ICON_STATE_TTL_SECONDS", DEFAULT_STATE_TTL_SECONDS)
    ddb.update_item(
        TableName=table_name,
        Key={"pk": _dynamo_s(_lease_pk(cycle=cycle, fhour=fhour))},
        UpdateExpression=(
            "SET #state = :complete, #cycle = :cycle, fhour = :fhour, completedAt = :now, #ttl = :ttl"
        ),
        ExpressionAttributeNames={"#cycle": "cycle", "#state": "state", "#ttl": "ttl"},
        ExpressionAttributeValues={
            ":complete": _dynamo_s("complete"),
            ":cycle": _dynamo_s(cycle),
            ":fhour": _dynamo_s(fhour),
            ":now": _dynamo_n(now_epoch),
            ":ttl": _dynamo_n(now_epoch + ttl_seconds),
        },
    )


def _submit_job(
    *,
    batch,
    queue: str,
    job_definition: str,
    pipeline_config_uri: str,
    cycle: str,
    run_id: str,
    fhour: str,
    attempt: int,
) -> str:
    suffix = hashlib.sha1(f"{cycle}:{run_id}:{fhour}:{attempt}".encode("utf-8")).hexdigest()[:8]
    job_name = f"icon-{cycle}-{run_id}-{fhour}-{suffix}"[:128]
    env_vars = [
        {"name": "MODEL", "value": MODEL_ID},
        {"name": "CYCLE", "value": cycle},
        {"name": "RUN_ID", "value": run_id},
        {"name": "FHOUR", "value": fhour},
        {"name": "PIPELINE_CONFIG_URI", "value": pipeline_config_uri},
    ]
    response = batch.submit_job(
        jobName=job_name,
        jobQueue=queue,
        jobDefinition=job_definition,
        containerOverrides={"environment": env_vars},
    )
    job_id = str(response.get("jobId", ""))
    print(
        f"submitted ICON job: jobName={job_name} jobId={job_id} cycle={cycle} run_id={run_id} fhour={fhour}",
        flush=True,
    )
    return job_id


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Poll DWD for ready ICON files and submit Batch jobs."""

    del context
    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
    state_table = os.environ["ICON_STATE_TABLE"]
    run_coordinator_table = os.environ["RUN_COORDINATOR_TABLE"]
    artifact_root_uri = os.environ["ARTIFACT_ROOT_URI"]
    pipeline_config_uri = os.environ.get("PIPELINE_CONFIG_URI", DEFAULT_PIPELINE_CONFIG_URI).strip()

    model = _model(pipeline_config_uri)
    if not model.workload.artifacts or not model.workload.forecast_hours:
        print("ICON workload is empty; nothing to submit", flush=True)
        return {"ok": True, "submitted": 0}

    now = _event_now(event)
    now_epoch = int(now.timestamp())
    cycles = _candidate_cycles(
        now=now,
        cycle_count=_positive_int_env("ICON_POLL_CYCLE_COUNT", DEFAULT_POLL_CYCLE_COUNT),
    )
    required_params = required_icon_params(model)
    previous_required_params = required_previous_icon_params(model)
    sentinel_params = _sentinel_params()
    min_bytes = _int_env("ICON_READY_MIN_BYTES", DEFAULT_READY_MIN_BYTES)

    batch = boto3.client("batch")
    ddb = boto3.client("dynamodb")
    store = make_store()
    paths = ArtifactPaths(artifact_root_uri)

    submitted = 0
    completed = 0
    pending = 0
    leased = 0
    skipped_cycles = 0

    for cycle in cycles:
        if not _params_ready(model=model, cycle=cycle, fhour="000", params=sentinel_params, min_bytes=min_bytes):
            skipped_cycles += 1
            continue

        cycle_run_id = coordinated_run_id(
            ddb=ddb,
            table_name=run_coordinator_table,
            model_id=MODEL_ID,
            cycle=cycle,
            now=now,
            ttl_seconds=run_coordinator_ttl_seconds(),
        )
        existing_markers = _existing_success_markers(
            store=store,
            paths=paths,
            model_id=model.id,
            cycle=cycle,
            run_id=cycle_run_id,
        )
        for fhour in model.workload.forecast_hours:
            if _hour_complete(
                paths=paths,
                existing_markers=existing_markers,
                model=model,
                cycle=cycle,
                run_id=cycle_run_id,
                fhour=fhour,
            ):
                _mark_complete(ddb=ddb, table_name=state_table, cycle=cycle, fhour=fhour, now_epoch=now_epoch)
                completed += 1
                continue

            if not _params_ready(model=model, cycle=cycle, fhour=fhour, params=required_params, min_bytes=min_bytes):
                pending += 1
                continue
            previous_fhour = previous_icon_fhour(fhour)
            if (
                previous_fhour is not None
                and previous_required_params
                and not _params_ready(
                    model=model,
                    cycle=cycle,
                    fhour=previous_fhour,
                    params=previous_required_params,
                    min_bytes=min_bytes,
                )
            ):
                pending += 1
                continue

            attempt = _try_acquire_lease(
                ddb=ddb,
                table_name=state_table,
                cycle=cycle,
                fhour=fhour,
                now_epoch=now_epoch,
            )
            if attempt is None:
                leased += 1
                continue

            job_id = _submit_job(
                batch=batch,
                queue=queue,
                job_definition=job_definition,
                pipeline_config_uri=pipeline_config_uri,
                cycle=cycle,
                run_id=cycle_run_id,
                fhour=fhour,
                attempt=attempt,
            )
            _record_submission(
                ddb=ddb,
                table_name=state_table,
                cycle=cycle,
                fhour=fhour,
                job_id=job_id,
                now_epoch=now_epoch,
            )
            submitted += 1

    return {
        "ok": True,
        "submitted": submitted,
        "completed": completed,
        "pending": pending,
        "leased": leased,
        "skippedCycles": skipped_cycles,
        "cycles": len(cycles),
    }
