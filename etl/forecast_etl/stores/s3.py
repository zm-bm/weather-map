"""S3 URI store.

Supports `s3://bucket/key` URIs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import boto3  # type: ignore
from botocore.exceptions import ClientError  # type: ignore

from .artifact_encoding import encode_artifact_body, is_gzip_encoded_artifact_key
from .base import UriObject, UriStore

LATEST_MANIFEST_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=60"
FORECAST_ARTIFACT_CACHE_CONTROL = "public, max-age=3600, s-maxage=21600, stale-while-revalidate=300"
INTERNAL_ARTIFACT_CACHE_CONTROL = "private, no-store"


@dataclass(frozen=True)
class S3Store(UriStore):
    """URI store implementation for S3 objects."""

    name: str = "s3"

    def _parse_s3_uri(self, uri: str) -> tuple[str, str]:
        parsed = urlparse(uri)
        if parsed.scheme != "s3":
            raise ValueError(f"Unsupported URI scheme for S3Store: {uri}")
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        if not bucket:
            raise ValueError(f"Invalid s3 uri (missing bucket): {uri}")
        return bucket, key

    def _client(self):
        # Cheap to create; boto3 internally caches connections.
        return boto3.client("s3")

    def _guess_content_type(self, *, key: str) -> str:
        k = key.lower()
        if k.endswith(".json") or k.endswith(".jsonl") or k.endswith(".geojson"):
            return "application/json"
        if k.endswith("_success.json") or k.endswith("_published.json"):
            return "application/json"
        return "application/octet-stream"

    def _is_gzip_encoded_artifact(self, *, key: str) -> bool:
        return is_gzip_encoded_artifact_key(key=key)

    def _guess_cache_control(self, *, key: str) -> str | None:
        segments = [segment for segment in key.lower().split("/") if segment]
        segment_set = set(segments)

        if "status" in segment_set or "logs" in segment_set:
            return INTERNAL_ARTIFACT_CACHE_CONTROL
        if "fields" in segment_set:
            return FORECAST_ARTIFACT_CACHE_CONTROL
        if "manifests" in segment_set:
            if segments[-1:] == ["latest.json"]:
                return LATEST_MANIFEST_CACHE_CONTROL
            if segments[-1].endswith(".json"):
                return FORECAST_ARTIFACT_CACHE_CONTROL
        return None

    def _put_extra_args(self, *, key: str) -> dict[str, str]:
        extra_args = {"ContentType": self._guess_content_type(key=key)}
        cache_control = self._guess_cache_control(key=key)
        if cache_control is not None:
            extra_args["CacheControl"] = cache_control
        if self._is_gzip_encoded_artifact(key=key):
            extra_args["ContentEncoding"] = "gzip"
        return extra_args

    def _encode_body(self, *, key: str, data: bytes) -> bytes:
        return encode_artifact_body(key=key, data=data)

    def _is_not_found(self, e: ClientError) -> bool:
        code = e.response.get("Error", {}).get("Code")
        return code in {"404", "NoSuchKey", "NotFound"}

    def read_bytes(self, *, uri: str) -> bytes:
        bucket, key = self._parse_s3_uri(uri)
        try:
            resp = self._client().get_object(Bucket=bucket, Key=key)
        except ClientError as e:
            if self._is_not_found(e):
                raise FileNotFoundError(uri) from e
            raise
        body = resp.get("Body")
        return body.read() if body is not None else b""

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        bucket, key = self._parse_s3_uri(uri)
        self._client().put_object(
            Bucket=bucket,
            Key=key,
            Body=self._encode_body(key=key, data=data),
            **self._put_extra_args(key=key),
        )

    def exists(self, *, uri: str) -> bool:
        bucket, key = self._parse_s3_uri(uri)
        s3 = self._client()

        if not key or key.endswith("/"):
            resp = s3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
            return bool(resp.get("KeyCount"))

        try:
            s3.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code")
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [obj.uri for obj in self.list_objects(prefix_uri=prefix_uri)]

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        bucket, prefix = self._parse_s3_uri(prefix_uri)
        s3 = self._client()
        paginator = s3.get_paginator("list_objects_v2")
        items: list[UriObject] = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []) or []:
                key = obj.get("Key")
                if isinstance(key, str) and key:
                    items.append(
                        UriObject(
                            uri=f"s3://{bucket}/{key}",
                            last_modified=_optional_datetime(obj.get("LastModified")),
                            size=_optional_int(obj.get("Size")),
                        )
                    )
        items.sort(key=lambda item: item.uri)
        return items

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        bucket, key = self._parse_s3_uri(uri)
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        s3 = self._client()
        try:
            with open(tmp, "wb") as f:
                s3.download_fileobj(bucket, key, f)
        except ClientError as e:
            tmp.unlink(missing_ok=True)
            if self._is_not_found(e):
                raise FileNotFoundError(uri) from e
            raise
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        tmp.replace(dst)

    def put_file(self, *, uri: str, src: Path) -> None:
        bucket, key = self._parse_s3_uri(uri)
        extra_args = self._put_extra_args(key=key)
        should_gzip = self._is_gzip_encoded_artifact(key=key)

        s3 = self._client()
        with open(src, "rb") as f:
            if should_gzip:
                s3.put_object(
                    Bucket=bucket,
                    Key=key,
                    Body=self._encode_body(key=key, data=f.read()),
                    **extra_args,
                )
                return

            s3.upload_fileobj(
                f,
                bucket,
                key,
                ExtraArgs=extra_args,
            )


def _optional_datetime(value: object) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None
