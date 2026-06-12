"""S3 URI store.

Supports `s3://bucket/key` URIs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

import boto3  # type: ignore
from botocore import UNSIGNED  # type: ignore
from botocore.config import Config  # type: ignore
from botocore.exceptions import ClientError  # type: ignore

from .base import UriObject, UriStore, UriWriteMetadata

DEFAULT_UNSIGNED_READ_BUCKETS = frozenset({"noaa-mrms-pds"})


@dataclass(frozen=True)
class S3Store(UriStore):
    """URI store implementation for S3 objects."""

    name: str = "s3"
    unsigned_read_buckets: frozenset[str] = DEFAULT_UNSIGNED_READ_BUCKETS

    def _parse_s3_uri(self, uri: str, *, require_key: bool = False) -> tuple[str, str]:
        parsed = urlparse(uri)
        if parsed.scheme != "s3":
            raise ValueError(f"Unsupported URI scheme for S3Store: {uri}")
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        if not bucket:
            raise ValueError(f"Invalid s3 uri (missing bucket): {uri}")
        if require_key and not key:
            raise ValueError(f"Invalid s3 object uri (missing key): {uri}")
        return bucket, key

    def _client(self):
        return _s3_client()

    def _read_client(self, bucket: str):
        if bucket in self.unsigned_read_buckets:
            return _unsigned_s3_client()
        return self._client()

    def _put_extra_args(self, *, metadata: UriWriteMetadata | None) -> dict[str, str]:
        if metadata is None:
            return {}
        extra_args: dict[str, str] = {}
        if metadata.content_type is not None:
            extra_args["ContentType"] = metadata.content_type
        if metadata.cache_control is not None:
            extra_args["CacheControl"] = metadata.cache_control
        if metadata.content_encoding is not None:
            extra_args["ContentEncoding"] = metadata.content_encoding
        return extra_args

    def _is_not_found(self, e: ClientError) -> bool:
        code = e.response.get("Error", {}).get("Code")
        return code in {"404", "NoSuchKey", "NotFound"}

    def read_bytes(self, *, uri: str) -> bytes:
        bucket, key = self._parse_s3_uri(uri, require_key=True)
        try:
            resp = self._read_client(bucket).get_object(Bucket=bucket, Key=key)
        except ClientError as e:
            if self._is_not_found(e):
                raise FileNotFoundError(uri) from e
            raise
        body = resp.get("Body")
        return body.read() if body is not None else b""

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        self.write_bytes_with_metadata(uri=uri, data=data, metadata=UriWriteMetadata())

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        bucket, key = self._parse_s3_uri(uri, require_key=True)
        self._client().put_object(Bucket=bucket, Key=key, Body=data, **self._put_extra_args(metadata=metadata))

    def delete_uri(self, *, uri: str) -> None:
        bucket, key = self._parse_s3_uri(uri, require_key=True)
        self._client().delete_object(Bucket=bucket, Key=key)

    def exists(self, *, uri: str) -> bool:
        bucket, key = self._parse_s3_uri(uri)
        s3 = self._read_client(bucket)

        if not key or key.endswith("/"):
            resp = s3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
            return bool(resp.get("KeyCount"))

        try:
            s3.head_object(Bucket=bucket, Key=key)
            return True
        except ClientError as e:
            if self._is_not_found(e):
                return False
            raise

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [obj.uri for obj in self.list_objects(prefix_uri=prefix_uri)]

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        bucket, prefix = self._parse_s3_uri(prefix_uri)
        s3 = self._read_client(bucket)
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
        bucket, key = self._parse_s3_uri(uri, require_key=True)
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        s3 = self._read_client(bucket)
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
        self.put_file_with_metadata(uri=uri, src=src, metadata=UriWriteMetadata())

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        bucket, key = self._parse_s3_uri(uri, require_key=True)
        extra_args = self._put_extra_args(metadata=metadata)

        s3 = self._client()
        with open(src, "rb") as f:
            if extra_args:
                s3.upload_fileobj(f, bucket, key, ExtraArgs=extra_args)
            else:
                s3.upload_fileobj(f, bucket, key)


def _optional_datetime(value: object) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None


@lru_cache(maxsize=1)
def _s3_client():
    return boto3.client(
        "s3",
        config=Config(
            max_pool_connections=64,
            connect_timeout=10,
            read_timeout=60,
        ),
    )


@lru_cache(maxsize=1)
def _unsigned_s3_client():
    return boto3.client(
        "s3",
        config=Config(
            signature_version=UNSIGNED,
            max_pool_connections=64,
            connect_timeout=10,
            read_timeout=60,
        ),
    )
