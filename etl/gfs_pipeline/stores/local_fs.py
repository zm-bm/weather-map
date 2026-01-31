"""Local filesystem URI store.

Supports `file://` URIs.

This store is used for local development and for wiring a future pipeline
where artifact roots may be on disk.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from .base import UriStore
from ..layout import path_from_file_uri


@dataclass(frozen=True)
class LocalFSStore(UriStore):
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

    def exists(self, *, uri: str) -> bool:
        return path_from_file_uri(uri).exists()

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        prefix_path = path_from_file_uri(prefix_uri)
        if prefix_path.is_file():
            return [prefix_uri]
        if not prefix_path.exists():
            return []
        items: list[str] = []
        for p in prefix_path.rglob("*"):
            if p.is_file():
                items.append(f"file://{p.as_posix()}")
        items.sort()
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
