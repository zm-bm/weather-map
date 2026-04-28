from __future__ import annotations

import gzip
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gfs_pipeline.stores.s3 import S3Store


class FakeS3Client:
    def __init__(self, payload: bytes = b"") -> None:
        self.payload = payload
        self.put_object_calls: list[dict[str, object]] = []
        self.upload_fileobj_calls: list[dict[str, object]] = []

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
        self.assertEqual(call["ContentEncoding"], "gzip")
        self.assertEqual(gzip.decompress(call["Body"]), payload)
        self.assertNotEqual(call["Body"], payload)

    def test_write_bytes_does_not_gzip_json_artifacts(self) -> None:
        client = FakeS3Client()
        store = S3Store()
        payload = b'{"ok":true}'

        with patch.object(S3Store, "_client", return_value=client):
            store.write_bytes(uri="s3://example-bucket/manifests/latest.json", data=payload)

        self.assertEqual(len(client.put_object_calls), 1)
        call = client.put_object_calls[0]
        self.assertEqual(call["Body"], payload)
        self.assertEqual(call["ContentType"], "application/json")
        self.assertNotIn("ContentEncoding", call)

    def test_put_file_gzip_encodes_field_payloads(self) -> None:
        client = FakeS3Client()
        store = S3Store()
        payload = b"\x00\x01\x02\x03" * 256

        with tempfile.TemporaryDirectory() as tmpdir:
            src = Path(tmpdir) / "wind10m_uv.vector.i8.bin"
            src.write_bytes(payload)

            with patch.object(S3Store, "_client", return_value=client):
                store.put_file(
                    uri="s3://example-bucket/fields/2026042700/006/wind10m_uv.vector.i8.bin",
                    src=src,
                )

        self.assertEqual(len(client.put_object_calls), 1)
        call = client.put_object_calls[0]
        self.assertEqual(call["ContentType"], "application/octet-stream")
        self.assertEqual(call["ContentEncoding"], "gzip")
        self.assertEqual(gzip.decompress(call["Body"]), payload)
        self.assertEqual(client.upload_fileobj_calls, [])


if __name__ == "__main__":
    unittest.main()
