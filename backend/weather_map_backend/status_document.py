from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

STATUS_DOCUMENT_SCHEMA = "weather-map.etl-status"
STATUS_DOCUMENT_SCHEMA_VERSION = 1
STATUS_DOCUMENT_FILENAME = "status.json"
DEFAULT_STATUS_DATASET_IDS = ("gfs", "icon")


def read_status_document(*, artifact_root_uri: str, s3_client: Any | None = None) -> dict[str, Any]:
    uri = _status_uri(artifact_root_uri)
    raw = _read_json(uri=uri, s3_client=s3_client)
    return parse_status_document(raw, uri=uri)


def parse_status_document(raw: Any, *, uri: str) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise ValueError(f"Invalid ETL status document {uri}: JSON document must be an object")

    document = dict(raw)
    if document.get("schema") != STATUS_DOCUMENT_SCHEMA:
        raise ValueError(f"Invalid ETL status document {uri}: schema must be {STATUS_DOCUMENT_SCHEMA!r}")
    if document.get("schema_version") != STATUS_DOCUMENT_SCHEMA_VERSION:
        raise ValueError(
            f"Invalid ETL status document {uri}: schema_version must be {STATUS_DOCUMENT_SCHEMA_VERSION}"
        )

    _require_string(document, "generated_at", uri=uri)
    _require_bool(document, "ok", uri=uri)
    _require_int(document, "dataset_count", uri=uri)
    _require_int(document, "bad_dataset_count", uri=uri)
    _require_int(document, "inspection_failure_count", uri=uri)

    datasets = document.get("datasets")
    if not isinstance(datasets, list):
        raise ValueError(f"Invalid ETL status document {uri}: datasets must be an array")
    if any(not isinstance(dataset, Mapping) for dataset in datasets):
        raise ValueError(f"Invalid ETL status document {uri}: datasets entries must be objects")

    manifest_index = document.get("manifest_index")
    if not isinstance(manifest_index, Mapping):
        raise ValueError(f"Invalid ETL status document {uri}: manifest_index must be an object")

    return document


def _status_uri(artifact_root_uri: str) -> str:
    root = artifact_root_uri.rstrip("/")
    if not root:
        raise ValueError("ARTIFACT_ROOT_URI must not be empty")
    return f"{root}/{STATUS_DOCUMENT_FILENAME}"


def _read_json(*, uri: str, s3_client: Any | None) -> Any:
    try:
        data = _read_bytes(uri=uri, s3_client=s3_client)
    except Exception as exc:
        raise ValueError(f"Unable to read ETL status document {uri}: {_error_message(exc)}") from exc

    try:
        return json.loads(data.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise ValueError(f"Invalid ETL status document {uri}: JSON must be UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid ETL status document {uri}: JSON is invalid: {exc.msg}") from exc


def _read_bytes(*, uri: str, s3_client: Any | None) -> bytes:
    parsed = urlparse(uri)
    if parsed.scheme == "s3":
        return _read_s3_bytes(parsed=parsed, s3_client=s3_client)
    if parsed.scheme == "file":
        return Path(unquote(parsed.path)).read_bytes()
    if parsed.scheme:
        raise ValueError(f"Unsupported status document URI scheme: {parsed.scheme!r}")
    return Path(uri).read_bytes()


def _read_s3_bytes(*, parsed, s3_client: Any | None) -> bytes:
    if s3_client is None:
        import boto3

        s3_client = boto3.client("s3")

    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    if not bucket or not key:
        raise ValueError(f"Invalid S3 status document URI: {parsed.geturl()!r}")

    body = s3_client.get_object(Bucket=bucket, Key=key)["Body"]
    data = body.read() if hasattr(body, "read") else body
    if isinstance(data, str):
        return data.encode("utf-8")
    return bytes(data)


def _require_string(document: Mapping[str, Any], field: str, *, uri: str) -> str:
    value = document.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid ETL status document {uri}: {field} must be a non-empty string")
    return value


def _require_bool(document: Mapping[str, Any], field: str, *, uri: str) -> bool:
    value = document.get(field)
    if not isinstance(value, bool):
        raise ValueError(f"Invalid ETL status document {uri}: {field} must be a boolean")
    return value


def _require_int(document: Mapping[str, Any], field: str, *, uri: str) -> int:
    value = document.get(field)
    if not isinstance(value, int):
        raise ValueError(f"Invalid ETL status document {uri}: {field} must be an integer")
    return value


def _error_message(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__
