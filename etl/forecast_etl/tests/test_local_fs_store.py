from __future__ import annotations

import gzip
import tempfile
import unittest
from pathlib import Path

from forecast_etl.stores.local_fs import LocalFSStore


class LocalFSStoreTests(unittest.TestCase):
    def test_write_bytes_gzip_encodes_field_payloads(self) -> None:
        store = LocalFSStore()
        payload = bytes(range(64)) * 8

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "fields" / "2026042700" / "003" / "tmp_surface.custom.bin"

            store.write_bytes(uri=path.as_uri(), data=payload)

            stored_payload = path.read_bytes()
            self.assertEqual(gzip.decompress(stored_payload), payload)
            self.assertNotEqual(stored_payload, payload)

    def test_write_bytes_does_not_gzip_json_artifacts(self) -> None:
        store = LocalFSStore()
        payload = b'{"ok":true}'

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "manifests" / "latest.json"

            store.write_bytes(uri=path.as_uri(), data=payload)

            self.assertEqual(path.read_bytes(), payload)

    def test_put_file_gzip_encodes_field_payloads(self) -> None:
        store = LocalFSStore()
        payload = b"\x00\x01\x02\x03" * 128

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            src = tmp_path / "wind10m_uv.vector.i8.bin"
            dst = tmp_path / "fields" / "2026042700" / "006" / "wind10m_uv.vector.i8.bin"
            src.write_bytes(payload)

            store.put_file(uri=dst.as_uri(), src=src)

            stored_payload = dst.read_bytes()
            self.assertEqual(gzip.decompress(stored_payload), payload)
            self.assertNotEqual(stored_payload, payload)


if __name__ == "__main__":
    unittest.main()
