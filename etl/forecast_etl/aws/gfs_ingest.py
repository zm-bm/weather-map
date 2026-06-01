"""AWS Lambda ingest handler for converting GFS notifications to Batch jobs."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import boto3  # type: ignore

from ..config.load import load_pipeline_config
from ..uris import default_pipeline_config_uri
from .run_coordinator import coordinated_run_id, run_coordinator_ttl_seconds

KEY_RE = re.compile(r"^gfs\.(\d{8})/(\d{2})/atmos/gfs\.t\d{2}z\.pgrb2\.0p25\.f(\d{3})$")
ALLOWED_CYCLES = {"00", "06", "12", "18"}
DEFAULT_PIPELINE_CONFIG_URI = default_pipeline_config_uri()
MODEL_ID = "gfs"
_FILTERS_CACHE_BY_URI: dict[str, dict[str, Any]] = {}


def _filters(pipeline_config_uri: str) -> dict[str, Any]:
    cached = _FILTERS_CACHE_BY_URI.get(pipeline_config_uri)
    if cached is not None:
        return cached

    try:
        cfg = load_pipeline_config(pipeline_config_uri)
        print(f"Loaded pipeline config from: {pipeline_config_uri}")
    except Exception as exc:
        print(f"Failed to load pipeline config from {pipeline_config_uri}: {exc}")
        resolved = {
            "artifacts": (),
            "allowed_fhours": set(),
            "has_work_items": False,
            "allowed_cycles": ALLOWED_CYCLES,
        }
        _FILTERS_CACHE_BY_URI[pipeline_config_uri] = resolved
        return resolved

    model = cfg.model(MODEL_ID)
    artifacts = tuple(model.workload.artifacts)
    allowed_fhours = set(model.workload.forecast_hours)

    resolved = {
        "artifacts": artifacts,
        "allowed_fhours": allowed_fhours,
        "has_work_items": bool(artifacts),
        "allowed_cycles": ALLOWED_CYCLES,
    }
    _FILTERS_CACHE_BY_URI[pipeline_config_uri] = resolved
    return resolved


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _extract_s3_objects(payload: Any) -> list[tuple[str, str]]:
    """Extract S3 bucket/key pairs from supported notification payloads."""

    payload = _parse_json(payload)
    out: list[tuple[str, str]] = []

    if isinstance(payload, dict) and isinstance(payload.get("Records"), list):
        for rec in payload["Records"]:
            if not isinstance(rec, dict):
                continue
            s3 = rec.get("s3")
            if isinstance(s3, dict):
                bucket = (((s3.get("bucket") or {}).get("name")) if isinstance(s3.get("bucket"), dict) else None)
                key = (((s3.get("object") or {}).get("key")) if isinstance(s3.get("object"), dict) else None)
                if isinstance(bucket, str) and isinstance(key, str):
                    out.append((bucket, key))

    if isinstance(payload, dict):
        bucket = payload.get("bucket") or payload.get("s3Bucket")
        key = payload.get("key") or payload.get("s3Key")
        if isinstance(bucket, str) and isinstance(key, str):
            out.append((bucket, key))

    return out


def _extract_from_event(event: dict[str, Any]) -> list[tuple[str, str]]:
    """Extract S3 object references from an SNS-wrapped Lambda event."""

    objects: list[tuple[str, str]] = []
    for rec in event.get("Records", []):
        if not isinstance(rec, dict):
            continue
        sns = rec.get("Sns")
        if not isinstance(sns, dict):
            continue
        msg = sns.get("Message")
        objects.extend(_extract_s3_objects(msg))
    return objects


def _submit_job(
    *,
    batch,
    ddb,
    queue: str,
    job_definition: str,
    run_coordinator_table: str,
    bucket: str,
    key: str,
    filters: dict[str, Any],
    pipeline_config_uri: str,
) -> int:
    """Submit one Batch worker job when the S3 key matches workload filters."""

    matched = KEY_RE.match(key)
    if not matched:
        print(f"skip key (filter): {key}")
        return 0

    cycle_date = matched.group(1)
    cycle_hour = matched.group(2)
    cycle = f"{cycle_date}{cycle_hour}"
    fhour = matched.group(3)

    if filters["allowed_cycles"] and cycle_hour not in filters["allowed_cycles"]:
        print(f"skip key (cycle filter): cycle_hour={cycle_hour} key={key}")
        return 0

    if filters["allowed_fhours"] and fhour not in filters["allowed_fhours"]:
        print(f"skip key (forecast hour filter): fhour={fhour} key={key}")
        return 0

    if not filters.get("has_work_items", False):
        print(f"skip key (no workload.artifacts configured): key={key}")
        return 0

    grib_source_uri = f"s3://{bucket}/{key}"
    run_id = coordinated_run_id(
        ddb=ddb,
        table_name=run_coordinator_table,
        model_id=MODEL_ID,
        cycle=cycle,
        now=datetime.now(timezone.utc),
        ttl_seconds=run_coordinator_ttl_seconds(),
    )
    suffix = hashlib.sha1(f"{cycle}:{run_id}:{fhour}:{key}".encode("utf-8")).hexdigest()[:8]
    job_name = f"gfs-{cycle}-{run_id}-{fhour}-{suffix}"[:128]

    env_vars = [
        {"name": "CYCLE", "value": cycle},
        {"name": "RUN_ID", "value": run_id},
        {"name": "FHOUR", "value": fhour},
        {"name": "MODEL", "value": MODEL_ID},
        {"name": "GRIB_SOURCE_URI", "value": grib_source_uri},
    ]
    if pipeline_config_uri.startswith("s3://"):
        env_vars.append({"name": "PIPELINE_CONFIG_URI", "value": pipeline_config_uri})

    batch.submit_job(
        jobName=job_name,
        jobQueue=queue,
        jobDefinition=job_definition,
        containerOverrides={"environment": env_vars},
    )
    print(
        f"submitted: {job_name} key={key} run_id={run_id} "
        f"artifacts={len(filters.get('artifacts', ()))}"
    )
    return 1


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda entrypoint for filtering GFS notifications into Batch jobs."""

    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
    run_coordinator_table = os.environ["RUN_COORDINATOR_TABLE"]
    pipeline_config_uri = os.environ.get("PIPELINE_CONFIG_URI", DEFAULT_PIPELINE_CONFIG_URI).strip()

    batch = boto3.client("batch")
    ddb = boto3.client("dynamodb")
    filters = _filters(pipeline_config_uri)

    s3_objects = _extract_from_event(event)
    if not s3_objects:
        print("No SNS/S3 objects found in event")
        return {"ok": True, "submitted": 0}

    submitted = 0
    for bucket, key in s3_objects:
        submitted += _submit_job(
            batch=batch,
            ddb=ddb,
            queue=queue,
            job_definition=job_definition,
            run_coordinator_table=run_coordinator_table,
            bucket=bucket,
            key=key,
            filters=filters,
            pipeline_config_uri=pipeline_config_uri,
        )

    return {"ok": True, "submitted": submitted, "seen": len(s3_objects)}
