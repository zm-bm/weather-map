from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from gfs_pipeline.stores.s3 import S3Store


class FakeS3Client:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def download_fileobj(self, bucket: str, key: str, handle) -> None:
        self.bucket = bucket
        self.key = key
        handle.write(self.payload)


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


if __name__ == "__main__":
    unittest.main()
