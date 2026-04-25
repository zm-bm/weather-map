from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any

import boto3  # type: ignore

from ..config import PipelineConfig

KEY_RE = re.compile(r"^gfs\.(\d{8})/(\d{2})/atmos/gfs\.t\d{2}z\.pgrb2\.0p25\.f(\d{3})$")
ALLOWED_CYCLES = {"00", "06", "12", "18"}
DEFAULT_PIPELINE_CONFIG_URI = "file:///var/task/gfs.etl_config.json"
_FILTERS_CACHE_BY_URI: dict[str, dict[str, Any]] = {}


def _filters(pipeline_config_uri: str) -> dict[str, Any]:
    cached = _FILTERS_CACHE_BY_URI.get(pipeline_config_uri)
    if cached is not None:
        return cached

    try:
        cfg = PipelineConfig.from_uri(pipeline_config_uri)
        print(f"Loaded pipeline config from: {pipeline_config_uri}")
    except Exception as exc:
        print(f"Failed to load pipeline config from {pipeline_config_uri}: {exc}")
        resolved = {
            "scalar_variables": (),
            "vector_variables": (),
            "allowed_fhours": set(),
            "has_work_items": False,
            "allowed_cycles": ALLOWED_CYCLES,
        }
        _FILTERS_CACHE_BY_URI[pipeline_config_uri] = resolved
        return resolved

    scalar_variables = tuple(cfg.workload.variables)
    vector_variables = tuple(str(key).strip() for key in cfg.vector_variables.keys() if str(key).strip())
    allowed_fhours = set(cfg.workload.forecast_hours)

    resolved = {
        "scalar_variables": scalar_variables,
        "vector_variables": vector_variables,
        "allowed_fhours": allowed_fhours,
        "has_work_items": bool(scalar_variables or vector_variables),
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
    queue: str,
    job_definition: str,
    bucket: str,
    key: str,
    filters: dict[str, Any],
    pipeline_config_uri: str,
) -> int:
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
        print(f"skip key (no workload.variables or vector_variables configured): key={key}")
        return 0

    grib_source_uri = f"s3://{bucket}/{key}"
    suffix = hashlib.sha1(f"{cycle}:{fhour}:{key}".encode("utf-8")).hexdigest()[:8]
    job_name = f"gfs-{cycle}-{fhour}-{suffix}"[:128]

    env_vars = [
        {"name": "CYCLE", "value": cycle},
        {"name": "FHOUR", "value": fhour},
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
        f"submitted: {job_name} key={key} "
        f"scalar_variables={len(filters.get('scalar_variables', ()))} "
        f"vector_variables={len(filters.get('vector_variables', ()))}"
    )
    return 1


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
    pipeline_config_uri = os.environ.get("PIPELINE_CONFIG_URI", DEFAULT_PIPELINE_CONFIG_URI).strip()

    batch = boto3.client("batch")
    filters = _filters(pipeline_config_uri)

    s3_objects = _extract_from_event(event)
    if not s3_objects:
        print("No SNS/S3 objects found in event")
        return {"ok": True, "submitted": 0}

    submitted = 0
    for bucket, key in s3_objects:
        submitted += _submit_job(
            batch=batch,
            queue=queue,
            job_definition=job_definition,
            bucket=bucket,
            key=key,
            filters=filters,
            pipeline_config_uri=pipeline_config_uri,
        )

    return {"ok": True, "submitted": submitted, "seen": len(s3_objects)}
