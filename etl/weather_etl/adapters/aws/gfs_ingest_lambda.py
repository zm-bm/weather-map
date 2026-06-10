"""AWS Lambda ingest handler for converting GFS notifications to Batch jobs."""

from __future__ import annotations

import json
import os
from typing import Any

import boto3  # type: ignore

from ...environment import EtlEnvironment
from ...operations.submit_gfs_source import GfsSourceObject, submit_gfs_source_object
from ...sources.submission import SourceSubmissionResult
from ...storage.routing import make_store
from ...storage.uris import default_artifact_root_uri, default_catalog_uri, default_pipeline_uri

DEFAULT_PIPELINE_URI = default_pipeline_uri()
DEFAULT_CATALOG_URI = default_catalog_uri()
DEFAULT_ARTIFACT_ROOT_URI = default_artifact_root_uri()


def _parse_json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _s3_object_from_record(record: dict[str, Any]) -> GfsSourceObject | None:
    s3 = record.get("s3")
    if not isinstance(s3, dict):
        return None
    bucket_obj = s3.get("bucket")
    object_obj = s3.get("object")
    bucket = bucket_obj.get("name") if isinstance(bucket_obj, dict) else None
    key = object_obj.get("key") if isinstance(object_obj, dict) else None
    return GfsSourceObject(bucket=bucket, key=key) if isinstance(bucket, str) and isinstance(key, str) else None


def _s3_object_from_flat_payload(payload: dict[str, Any]) -> GfsSourceObject | None:
    bucket = payload.get("bucket") or payload.get("s3Bucket")
    key = payload.get("key") or payload.get("s3Key")
    return GfsSourceObject(bucket=bucket, key=key) if isinstance(bucket, str) and isinstance(key, str) else None


def _extract_s3_objects(payload: Any) -> list[GfsSourceObject]:
    """Extract S3 bucket/key pairs from supported notification payloads."""

    payload = _parse_json(payload)
    out: list[GfsSourceObject] = []

    if isinstance(payload, dict) and isinstance(payload.get("Records"), list):
        for rec in payload["Records"]:
            if not isinstance(rec, dict):
                continue
            obj = _s3_object_from_record(rec)
            if obj is not None:
                out.append(obj)

    if isinstance(payload, dict):
        obj = _s3_object_from_flat_payload(payload)
        if obj is not None:
            out.append(obj)

    return out


def _extract_from_event(event: dict[str, Any]) -> list[GfsSourceObject]:
    """Extract S3 object references from an SNS-wrapped Lambda event."""

    objects: list[GfsSourceObject] = []
    for rec in event.get("Records", []):
        if not isinstance(rec, dict):
            continue
        sns = rec.get("Sns")
        if not isinstance(sns, dict):
            continue
        msg = sns.get("Message")
        objects.extend(_extract_s3_objects(msg))
    return objects


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda entrypoint for filtering GFS notifications into Batch jobs."""

    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
    run_coordinator_table = os.environ["RUN_COORDINATOR_TABLE"]
    frame_claim_table = os.environ["FRAME_CLAIM_TABLE"]
    artifact_root_uri = os.environ.get("ARTIFACT_ROOT_URI", DEFAULT_ARTIFACT_ROOT_URI).strip()
    pipeline_uri = os.environ.get("PIPELINE_URI", DEFAULT_PIPELINE_URI).strip()
    catalog_uri = os.environ.get("CATALOG_URI", DEFAULT_CATALOG_URI).strip()

    batch = boto3.client("batch")
    ddb = boto3.client("dynamodb")
    store = make_store()
    env = EtlEnvironment(
        artifact_root_uri=artifact_root_uri,
        pipeline_uri=pipeline_uri,
        catalog_uri=catalog_uri,
        store=store,
    )

    s3_objects = _extract_from_event(event)
    if not s3_objects:
        print("No SNS/S3 objects found in event")
        return {"ok": True, "submitted": 0}

    results: list[SourceSubmissionResult] = []
    for source_object in s3_objects:
        results.append(
            submit_gfs_source_object(
                batch=batch,
                ddb=ddb,
                queue=queue,
                job_definition=job_definition,
                run_coordinator_table=run_coordinator_table,
                frame_claim_table=frame_claim_table,
                env=env,
                source_object=source_object,
            )
        )

    result = SourceSubmissionResult.combine(results)
    return {"ok": True, "submitted": result.submitted, "seen": len(s3_objects)}
