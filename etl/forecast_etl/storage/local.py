"""Local filesystem URI store.

Supports `file://` URIs.

This store is used for local development and for wiring a future pipeline
where artifact roots may be on disk.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ..uris import path_from_file_uri
from .base import UriObject, UriStore, UriWriteMetadata


@dataclass(frozen=True)
class LocalFSStore(UriStore):
    """URI store implementation for local `file://` artifacts."""

    name: str = "local-fs"

    def read_bytes(self, *, uri: str) -> bytes:
        path = path_from_file_uri(uri)
        return path.read_bytes()

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        path = path_from_file_uri(uri)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        del metadata
        self.write_bytes(uri=uri, data=data)

    def exists(self, *, uri: str) -> bool:
        return path_from_file_uri(uri).exists()

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [obj.uri for obj in self.list_objects(prefix_uri=prefix_uri)]

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        prefix_path = path_from_file_uri(prefix_uri)
        if prefix_path.is_file():
            return [self._object(prefix_path)]
        if not prefix_path.exists():
            return []
        items: list[UriObject] = []
        for p in prefix_path.rglob("*"):
            if p.is_file():
                items.append(self._object(p))
        items.sort(key=lambda obj: obj.uri)
        return items

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        src = path_from_file_uri(uri)
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        shutil.copyfile(src, tmp)
        tmp.replace(dst)

    def put_file(self, *, uri: str, src: Path) -> None:
        dst = path_from_file_uri(uri)
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")
        shutil.copyfile(src, tmp)
        tmp.replace(dst)

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        del metadata
        self.put_file(uri=uri, src=src)

    def _object(self, path: Path) -> UriObject:
        stat = path.stat()
        return UriObject(
            uri=path.as_uri(),
            last_modified=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            size=stat.st_size,
        )
