"""AWS Lambda ingest handler for MRMS SQS/SNS object notifications."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import unquote_plus

import boto3  # type: ignore

from ...environment import EtlEnvironment
from ...operations.submit_mrms_source import MrmsSourceObject, submit_mrms_source_object
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


def _s3_object_from_record(record: dict[str, Any]) -> MrmsSourceObject | None:
    s3 = record.get("s3")
    if not isinstance(s3, dict):
        return None
    bucket_obj = s3.get("bucket")
    object_obj = s3.get("object")
    bucket = bucket_obj.get("name") if isinstance(bucket_obj, dict) else None
    key = object_obj.get("key") if isinstance(object_obj, dict) else None
    if not isinstance(bucket, str) or not isinstance(key, str):
        return None
    return MrmsSourceObject(bucket=bucket, key=unquote_plus(key))


def _s3_object_from_flat_payload(payload: dict[str, Any]) -> MrmsSourceObject | None:
    bucket = payload.get("bucket") or payload.get("s3Bucket")
    key = payload.get("key") or payload.get("s3Key")
    if not isinstance(bucket, str) or not isinstance(key, str):
        return None
    return MrmsSourceObject(bucket=bucket, key=unquote_plus(key))


def _extract_s3_objects(payload: Any) -> list[MrmsSourceObject]:
    """Extract S3 bucket/key pairs from supported S3/SNS payloads."""

    payload = _parse_json(payload)
    out: list[MrmsSourceObject] = []

    if isinstance(payload, dict) and isinstance(payload.get("Records"), list):
        for rec in payload["Records"]:
            if not isinstance(rec, dict):
                continue
            obj = _s3_object_from_record(rec)
            if obj is not None:
                out.append(obj)

    if isinstance(payload, dict):
        sns = payload.get("Sns")
        if isinstance(sns, dict):
            out.extend(_extract_s3_objects(sns.get("Message")))
        elif isinstance(payload.get("Message"), str):
            out.extend(_extract_s3_objects(payload.get("Message")))

        obj = _s3_object_from_flat_payload(payload)
        if obj is not None:
            out.append(obj)

    return out


def _extract_from_event(event: dict[str, Any]) -> list[MrmsSourceObject]:
    """Extract S3 object references from SQS records with SNS-wrapped bodies."""

    objects: list[MrmsSourceObject] = []
    for rec in event.get("Records", []):
        if not isinstance(rec, dict):
            continue
        if isinstance(rec.get("body"), str):
            objects.extend(_extract_s3_objects(rec["body"]))
            continue
        sns = rec.get("Sns")
        if isinstance(sns, dict):
            objects.extend(_extract_s3_objects(sns.get("Message")))
    return objects


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda entrypoint for filtering MRMS SQS/SNS notifications into Batch jobs."""

    del context
    queue = os.environ["BATCH_JOB_QUEUE"]
    job_definition = os.environ["BATCH_JOB_DEFINITION"]
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

    s3_objects = _extract_from_event(event if isinstance(event, dict) else {})
    if not s3_objects:
        print("No SQS/SNS/S3 objects found in MRMS event")
        return {"ok": True, "submitted": 0, "seen": 0}

    results: list[SourceSubmissionResult] = []
    for source_object in s3_objects:
        results.append(
            submit_mrms_source_object(
                batch=batch,
                ddb=ddb,
                queue=queue,
                job_definition=job_definition,
                frame_claim_table=frame_claim_table,
                env=env,
                source_object=source_object,
            )
        )

    result = SourceSubmissionResult.combine(results)
    return {
        "ok": True,
        "submitted": result.submitted,
        "pending": result.pending,
        "seen": len(s3_objects),
    }
