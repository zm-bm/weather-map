from __future__ import annotations

import gzip
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from typing import cast
from unittest.mock import patch

from forecast_etl.stores.s3 import (
    FORECAST_ARTIFACT_CACHE_CONTROL,
    INTERNAL_ARTIFACT_CACHE_CONTROL,
    LATEST_MANIFEST_CACHE_CONTROL,
    S3Store,
)


class FakeS3Client:
    def __init__(self, payload: bytes = b"") -> None:
        self.payload = payload
        self.put_object_calls: list[dict[str, object]] = []
        self.upload_fileobj_calls: list[dict[str, object]] = []
        self.list_pages: list[dict[str, object]] = []

    def download_fileobj(self, bucket: str, key: str, handle) -> None:
        self.bucket = bucket
        self.key = key
        handle.write(self.payload)

    def put_object(self, **kwargs: object) -> None:
        self.put_object_calls.append(kwargs)

    def upload_fileobj(self, handle, bucket: str, key: str, ExtraArgs: dict[str, str]) -> None:
        self.upload_fileobj_calls.append({
            "bucket": bucket,
            "key": key,
            "body": handle.read(),
            "ExtraArgs": ExtraArgs,
        })

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


class S3StoreTests(unittest.TestCase):
    def test_get_to_file_keeps_downloaded_tmp_until_replace(self) -> None:
        client = FakeS3Client(b"grib bytes")
        store = S3Store()

        with tempfile.TemporaryDirectory() as tmpdir:
            dst = Path(tmpdir) / "input.grib2"

            with patch.object(S3Store, "_client", return_value=client):
                store.get_to_file(uri="s3://example-bucket/path/input.grib2", dst=dst)

            self.assertEqual(dst.read_bytes(), b"grib bytes")
            self.assertFalse(dst.with_suffix(".grib2.tmp").exists())
            self.assertEqual(client.bucket, "example-bucket")
            self.assertEqual(client.key, "path/input.grib2")

    def test_write_bytes_gzip_encodes_field_payloads(self) -> None:
        client = FakeS3Client()
        store = S3Store()
        payload = bytes(range(256)) * 4

        with patch.object(S3Store, "_client", return_value=client):
            store.write_bytes(
                uri="s3://example-bucket/prefix/fields/2026042700/003/tmp_surface.custom.bin",
                data=payload,
            )

        self.assertEqual(len(client.put_object_calls), 1)
        call = client.put_object_calls[0]
        self.assertEqual(call["Bucket"], "example-bucket")
        self.assertEqual(call["Key"], "prefix/fields/2026042700/003/tmp_surface.custom.bin")
        self.assertEqual(call["ContentType"], "application/octet-stream")
        self.assertEqual(call["CacheControl"], FORECAST_ARTIFACT_CACHE_CONTROL)
        self.assertEqual(call["ContentEncoding"], "gzip")
        self.assertEqual(gzip.decompress(cast(bytes, call["Body"])), payload)
        self.assertNotEqual(call["Body"], payload)

    def test_write_bytes_sets_latest_manifest_cache_control(self) -> None:
        client = FakeS3Client()
        store = S3Store()
        payload = b'{"ok":true}'

        with patch.object(S3Store, "_client", return_value=client):
            store.write_bytes(uri="s3://example-bucket/manifests/gfs/latest.json", data=payload)

        self.assertEqual(len(client.put_object_calls), 1)
        call = client.put_object_calls[0]
        self.assertEqual(call["Body"], payload)
        self.assertEqual(call["ContentType"], "application/json")
        self.assertEqual(call["CacheControl"], LATEST_MANIFEST_CACHE_CONTROL)
        self.assertNotIn("ContentEncoding", call)

    def test_write_bytes_sets_cycle_manifest_cache_control(self) -> None:
        client = FakeS3Client()
        store = S3Store()

        with patch.object(S3Store, "_client", return_value=client):
            store.write_bytes(uri="s3://example-bucket/artifacts/manifests/gfs/2026042700.json", data=b"{}")

        call = client.put_object_calls[0]
        self.assertEqual(call["ContentType"], "application/json")
        self.assertEqual(call["CacheControl"], FORECAST_ARTIFACT_CACHE_CONTROL)

    def test_write_bytes_sets_internal_artifact_cache_control(self) -> None:
        for uri in (
            "s3://example-bucket/status/gfs/2026042700/_PUBLISHED.json",
            "s3://example-bucket/logs/gfs/2026042700/tmp_surface/003.log",
        ):
            with self.subTest(uri=uri):
                client = FakeS3Client()
                store = S3Store()

                with patch.object(S3Store, "_client", return_value=client):
                    store.write_bytes(uri=uri, data=b"{}")

                call = client.put_object_calls[0]
                self.assertEqual(call["CacheControl"], INTERNAL_ARTIFACT_CACHE_CONTROL)

    def test_put_file_gzip_encodes_field_payloads(self) -> None:
        client = FakeS3Client()
        store = S3Store()
        payload = b"\x00\x01\x02\x03" * 256

        with tempfile.TemporaryDirectory() as tmpdir:
            src = Path(tmpdir) / "wind10m_uv.field.i8.bin"
            src.write_bytes(payload)

            with patch.object(S3Store, "_client", return_value=client):
                store.put_file(
                    uri="s3://example-bucket/fields/2026042700/006/wind10m_uv.field.i8.bin",
                    src=src,
                )

        self.assertEqual(len(client.put_object_calls), 1)
        call = client.put_object_calls[0]
        self.assertEqual(call["ContentType"], "application/octet-stream")
        self.assertEqual(call["CacheControl"], FORECAST_ARTIFACT_CACHE_CONTROL)
        self.assertEqual(call["ContentEncoding"], "gzip")
        self.assertEqual(gzip.decompress(cast(bytes, call["Body"])), payload)
        self.assertEqual(client.upload_fileobj_calls, [])

    def test_list_objects_returns_s3_metadata(self) -> None:
        modified = datetime(2026, 5, 11, 14, 0, tzinfo=timezone.utc)
        client = FakeS3Client()
        client.list_pages = [
            {
                "Contents": [
                    {"Key": "status/gfs/2026042700/tmp/000._SUCCESS.json", "LastModified": modified, "Size": 2},
                    {"Key": "status/gfs/2026042700/_PUBLISHED.json", "LastModified": modified, "Size": 3},
                ]
            }
        ]
        store = S3Store()

        with patch.object(S3Store, "_client", return_value=client):
            objects = store.list_objects(prefix_uri="s3://example-bucket/status/gfs/2026042700/")

        self.assertEqual(client.paginator_name, "list_objects_v2")
        self.assertEqual(
            [(obj.uri, obj.last_modified, obj.size) for obj in objects],
            [
                ("s3://example-bucket/status/gfs/2026042700/_PUBLISHED.json", modified, 3),
                ("s3://example-bucket/status/gfs/2026042700/tmp/000._SUCCESS.json", modified, 2),
            ],
        )


if __name__ == "__main__":
    unittest.main()
