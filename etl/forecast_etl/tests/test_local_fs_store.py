from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from forecast_etl.storage.local import LocalFSStore


class LocalFSStoreTests(unittest.TestCase):
    def test_write_bytes_writes_raw_payloads(self) -> None:
        store = LocalFSStore()
        payload = bytes(range(64)) * 8

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "fields" / "2026042700" / "003" / "tmp_surface.custom.bin"

            store.write_bytes(uri=path.as_uri(), data=payload)

            self.assertEqual(path.read_bytes(), payload)

    def test_delete_uri_removes_file_if_present(self) -> None:
        store = LocalFSStore()

        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "runs" / "gfs" / "2026042700" / "run.json"
            path.parent.mkdir(parents=True)
            path.write_text("{}", encoding="utf-8")

            store.delete_uri(uri=path.as_uri())
            store.delete_uri(uri=path.as_uri())

            self.assertFalse(path.exists())

    def test_put_file_copies_raw_payloads(self) -> None:
        store = LocalFSStore()
        payload = b"\x00\x01\x02\x03" * 128

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            src = tmp_path / "wind10m_uv.field.i8.bin"
            dst = tmp_path / "fields" / "2026042700" / "006" / "wind10m_uv.field.i8.bin"
            src.write_bytes(payload)

            store.put_file(uri=dst.as_uri(), src=src)

            self.assertEqual(dst.read_bytes(), payload)

    def test_list_objects_returns_file_metadata(self) -> None:
        store = LocalFSStore()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            first = root / "status" / "gfs" / "2026042700" / "tmp" / "000._SUCCESS.json"
            second = root / "status" / "gfs" / "2026042700" / "_PUBLISHED.json"
            first.parent.mkdir(parents=True)
            first.write_text("{}", encoding="utf-8")
            second.write_text("{}", encoding="utf-8")

            objects = store.list_objects(prefix_uri=(root / "status" / "gfs" / "2026042700").as_uri())

        self.assertEqual([obj.uri for obj in objects], sorted(obj.uri for obj in objects))
        self.assertEqual(len(objects), 2)
        self.assertTrue(all(isinstance(obj.last_modified, datetime) for obj in objects))
        self.assertEqual({obj.size for obj in objects}, {2})


if __name__ == "__main__":
    unittest.main()
