"""S3 URI store.

Supports `s3://bucket/key` URIs.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import boto3  # type: ignore
from botocore.exceptions import ClientError  # type: ignore

from .base import UriStore


@dataclass(frozen=True)
class S3Store(UriStore):
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
        if k.endswith(".mbtiles"):
            return "application/x-sqlite3"
        return "application/octet-stream"

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
        content_type = self._guess_content_type(key=key)
        self._client().put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)

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
        bucket, prefix = self._parse_s3_uri(prefix_uri)
        s3 = self._client()
        paginator = s3.get_paginator("list_objects_v2")
        items: list[str] = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []) or []:
                key = obj.get("Key")
                if isinstance(key, str) and key:
                    items.append(f"s3://{bucket}/{key}")
        items.sort()
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
            if self._is_not_found(e):
                raise FileNotFoundError(uri) from e
            raise
        finally:
            if tmp.exists() and not dst.exists():
                tmp.unlink(missing_ok=True)
        tmp.replace(dst)

    def put_file(self, *, uri: str, src: Path) -> None:
        bucket, key = self._parse_s3_uri(uri)
        content_type = self._guess_content_type(key=key)

        s3 = self._client()
        with open(src, "rb") as f:
            s3.upload_fileobj(
                f,
                bucket,
                key,
                ExtraArgs={"ContentType": content_type},
            )
