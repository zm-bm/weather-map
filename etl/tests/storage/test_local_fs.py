from __future__ import annotations

from datetime import datetime
from pathlib import Path

from weather_etl.storage.local import LocalFSStore


def test_write_bytes_writes_raw_payloads(tmp_path: Path) -> None:
    store = LocalFSStore()
    payload = bytes(range(64)) * 8
    path = tmp_path / "payloads" / "2026042700" / "003" / "tmp_surface.custom.bin"

    store.write_bytes(uri=path.as_uri(), data=payload)

    assert path.read_bytes() == payload


def test_delete_uri_removes_file_if_present(tmp_path: Path) -> None:
    store = LocalFSStore()
    path = tmp_path / "runs" / "gfs" / "2026042700" / "run.json"
    path.parent.mkdir(parents=True)
    path.write_text("{}", encoding="utf-8")

    store.delete_uri(uri=path.as_uri())
    store.delete_uri(uri=path.as_uri())

    assert not path.exists()


def test_put_file_copies_raw_payloads(tmp_path: Path) -> None:
    store = LocalFSStore()
    payload = b"\x00\x01\x02\x03" * 128
    src = tmp_path / "wind10m_uv.i8.bin"
    dst = tmp_path / "payloads" / "2026042700" / "006" / "wind10m_uv.i8.bin"
    src.write_bytes(payload)

    store.put_file(uri=dst.as_uri(), src=src)

    assert dst.read_bytes() == payload


def test_list_objects_returns_file_metadata(tmp_path: Path) -> None:
    store = LocalFSStore()
    first = tmp_path / "status" / "gfs" / "2026042700" / "tmp" / "000._SUCCESS.json"
    second = tmp_path / "status" / "gfs" / "2026042700" / "publication.json"
    first.parent.mkdir(parents=True)
    first.write_text("{}", encoding="utf-8")
    second.write_text("{}", encoding="utf-8")

    objects = store.list_objects(prefix_uri=(tmp_path / "status" / "gfs" / "2026042700").as_uri())

    assert [obj.uri for obj in objects] == sorted(obj.uri for obj in objects)
    assert len(objects) == 2
    assert all(isinstance(obj.last_modified, datetime) for obj in objects)
    assert {obj.size for obj in objects} == {2}
