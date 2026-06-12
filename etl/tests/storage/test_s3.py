from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from weather_etl.storage.base import UriWriteMetadata
from weather_etl.storage.s3 import S3Store


class FakeS3Client:
    def __init__(self, payload: bytes = b"") -> None:
        self.payload = payload
        self.put_object_calls: list[dict[str, object]] = []
        self.delete_object_calls: list[dict[str, object]] = []
        self.upload_fileobj_calls: list[dict[str, object]] = []
        self.list_pages: list[dict[str, object]] = []
        self.list_objects_v2_calls: list[dict[str, object]] = []
        self.list_objects_v2_response: dict[str, object] = {"KeyCount": 0}

    def download_fileobj(self, bucket: str, key: str, handle) -> None:
        self.bucket = bucket
        self.key = key
        handle.write(self.payload)

    def put_object(self, **kwargs: object) -> None:
        self.put_object_calls.append(kwargs)

    def delete_object(self, **kwargs: object) -> None:
        self.delete_object_calls.append(kwargs)

    def upload_fileobj(self, handle, bucket: str, key: str, ExtraArgs: dict[str, str] | None = None) -> None:
        self.upload_fileobj_calls.append({
            "bucket": bucket,
            "key": key,
            "body": handle.read(),
            "ExtraArgs": ExtraArgs or {},
        })

    def list_objects_v2(self, **kwargs: object) -> dict[str, object]:
        self.list_objects_v2_calls.append(kwargs)
        return self.list_objects_v2_response

    def get_paginator(self, name: str):
        self.paginator_name = name
        return _FakePaginator(self.list_pages)


class _FakePaginator:
    def __init__(self, pages: list[dict[str, object]]) -> None:
        self.pages = pages
        self.paginate_calls: list[dict[str, object]] = []

    def paginate(self, **kwargs: object):
        self.paginate_calls.append(kwargs)
        return self.pages


def test_get_to_file_keeps_downloaded_tmp_until_replace(tmp_path: Path) -> None:
    client = FakeS3Client(b"grib bytes")
    store = S3Store()
    dst = tmp_path / "input.grib2"

    with patch.object(S3Store, "_client", return_value=client):
        store.get_to_file(uri="s3://example-bucket/path/input.grib2", dst=dst)

    assert dst.read_bytes() == b"grib bytes"
    assert not dst.with_suffix(".grib2.tmp").exists()
    assert client.bucket == "example-bucket"
    assert client.key == "path/input.grib2"


def test_public_read_bucket_uses_unsigned_s3_client(tmp_path: Path) -> None:
    signed_client = FakeS3Client(b"signed")
    unsigned_client = FakeS3Client(b"public")
    store = S3Store(unsigned_read_buckets=frozenset({"public-bucket"}))
    dst = tmp_path / "input.grib2"

    with (
        patch.object(S3Store, "_client", return_value=signed_client),
        patch("weather_etl.storage.s3._unsigned_s3_client", return_value=unsigned_client),
    ):
        store.get_to_file(uri="s3://public-bucket/path/input.grib2", dst=dst)

    assert dst.read_bytes() == b"public"
    assert not hasattr(signed_client, "bucket")
    assert unsigned_client.bucket == "public-bucket"
    assert unsigned_client.key == "path/input.grib2"


def test_write_bytes_writes_raw_payloads_without_artifact_headers() -> None:
    client = FakeS3Client()
    store = S3Store()
    payload = bytes(range(256)) * 4

    with patch.object(S3Store, "_client", return_value=client):
        store.write_bytes(
            uri="s3://example-bucket/prefix/runs/gfs/2026042700/20260427T000000Z-00000000/payloads/003/tmp_surface.custom.bin",
            data=payload,
        )

    assert len(client.put_object_calls) == 1
    call = client.put_object_calls[0]
    assert call["Bucket"] == "example-bucket"
    assert call["Key"] == "prefix/runs/gfs/2026042700/20260427T000000Z-00000000/payloads/003/tmp_surface.custom.bin"
    assert call["Body"] == payload
    assert "ContentType" not in call
    assert "CacheControl" not in call
    assert "ContentEncoding" not in call


def test_write_bytes_with_metadata_sets_generic_headers() -> None:
    client = FakeS3Client()
    store = S3Store()
    payload = b'{"ok":true}'

    with patch.object(S3Store, "_client", return_value=client):
        store.write_bytes_with_metadata(
            uri="s3://example-bucket/manifests/gfs/latest.json",
            data=payload,
            metadata=UriWriteMetadata(
                content_type="application/json",
                cache_control="public, max-age=60",
                content_encoding="gzip",
            ),
        )

    assert len(client.put_object_calls) == 1
    call = client.put_object_calls[0]
    assert call["Body"] == payload
    assert call["ContentType"] == "application/json"
    assert call["CacheControl"] == "public, max-age=60"
    assert call["ContentEncoding"] == "gzip"


def test_delete_uri_deletes_object() -> None:
    client = FakeS3Client()
    store = S3Store()

    with patch.object(S3Store, "_client", return_value=client):
        store.delete_uri(uri="s3://example-bucket/runs/gfs/2026042700/run.json")

    assert client.delete_object_calls == [{"Bucket": "example-bucket", "Key": "runs/gfs/2026042700/run.json"}]


def test_put_file_copies_raw_payloads_without_artifact_headers(tmp_path: Path) -> None:
    client = FakeS3Client()
    store = S3Store()
    payload = b"\x00\x01\x02\x03" * 256
    src = tmp_path / "wind10m_uv.i8.bin"
    src.write_bytes(payload)

    with patch.object(S3Store, "_client", return_value=client):
        store.put_file(
            uri="s3://example-bucket/runs/gfs/2026042700/20260427T000000Z-00000000/payloads/006/wind10m_uv.i8.bin",
            src=src,
        )

    assert client.put_object_calls == []
    assert len(client.upload_fileobj_calls) == 1
    call = client.upload_fileobj_calls[0]
    assert call["body"] == payload
    assert call["ExtraArgs"] == {}


@pytest.mark.parametrize(
    "operation",
    (
        lambda store, src, dst: store.read_bytes(uri="s3://example-bucket"),
        lambda store, src, dst: store.write_bytes(uri="s3://example-bucket", data=b"payload"),
        lambda store, src, dst: store.write_bytes_with_metadata(
            uri="s3://example-bucket",
            data=b"payload",
            metadata=UriWriteMetadata(content_type="application/octet-stream"),
        ),
        lambda store, src, dst: store.delete_uri(uri="s3://example-bucket"),
        lambda store, src, dst: store.get_to_file(uri="s3://example-bucket", dst=dst),
        lambda store, src, dst: store.put_file(uri="s3://example-bucket", src=src),
        lambda store, src, dst: store.put_file_with_metadata(
            uri="s3://example-bucket",
            src=src,
            metadata=UriWriteMetadata(content_type="application/octet-stream"),
        ),
    ),
)
def test_object_operations_reject_empty_s3_keys(operation, tmp_path: Path) -> None:
    store = S3Store()
    src = tmp_path / "src.bin"
    dst = tmp_path / "dst.bin"
    src.write_bytes(b"payload")

    with pytest.raises(ValueError, match="missing key"):
        operation(store, src, dst)


def test_exists_allows_bucket_root_prefix() -> None:
    client = FakeS3Client()
    client.list_objects_v2_response = {"KeyCount": 1}
    store = S3Store()

    with patch.object(S3Store, "_client", return_value=client):
        assert store.exists(uri="s3://example-bucket/")

    assert client.list_objects_v2_calls == [{"Bucket": "example-bucket", "Prefix": "", "MaxKeys": 1}]


def test_list_objects_returns_s3_metadata() -> None:
    modified = datetime(2026, 5, 11, 14, 0, tzinfo=timezone.utc)
    client = FakeS3Client()
    client.list_pages = [
        {
            "Contents": [
                {"Key": "status/gfs/2026042700/tmp/000._SUCCESS.json", "LastModified": modified, "Size": 2},
                {"Key": "status/gfs/2026042700/publication.json", "LastModified": modified, "Size": 3},
            ]
        }
    ]
    store = S3Store()

    with patch.object(S3Store, "_client", return_value=client):
        objects = store.list_objects(prefix_uri="s3://example-bucket/status/gfs/2026042700/")

    assert client.paginator_name == "list_objects_v2"
    assert [(obj.uri, obj.last_modified, obj.size) for obj in objects] == [
        ("s3://example-bucket/status/gfs/2026042700/publication.json", modified, 3),
        ("s3://example-bucket/status/gfs/2026042700/tmp/000._SUCCESS.json", modified, 2),
    ]
