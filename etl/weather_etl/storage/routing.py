"""URI-based storage abstraction.

The ETL pipeline reads inputs and publishes artifacts via a simple `UriStore`
protocol. A `RoutingStore` dispatches operations based on the URI scheme.

Supported schemes:
- local filesystem paths and `file:///...`
- `s3://` (AWS S3)
- `http(s)://` (read-only)
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse

from ..storage.uris import normalize_resource_uri
from .base import UriObject, UriStore, UriWriteMetadata
from .http import HttpStore
from .local import LocalFSStore
from .s3 import S3Store


@dataclass(frozen=True)
class RoutingStore(UriStore):
    """Dispatch URI store calls by URI scheme.

    Use this when inputs/outputs may live on different schemes.
    """

    stores: Mapping[str, UriStore]
    name: str = "router"

    def _route(self, uri: str) -> tuple[UriStore, str]:
        allowed_schemes = tuple(self.stores.keys())
        normalized_uri = normalize_resource_uri(uri, allowed_schemes=allowed_schemes)
        parsed = urlparse(normalized_uri)
        scheme = parsed.scheme

        store = self.stores.get(scheme)
        if store is None:
            raise ValueError(f"Unsupported URI scheme: {scheme!r} (uri={uri!r})")
        return store, normalized_uri

    def read_bytes(self, *, uri: str) -> bytes:
        store, u = self._route(uri)
        return store.read_bytes(uri=u)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        store, u = self._route(uri)
        return store.write_bytes(uri=u, data=data)

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        store, u = self._route(uri)
        return store.write_bytes_with_metadata(uri=u, data=data, metadata=metadata)

    def delete_uri(self, *, uri: str) -> None:
        store, u = self._route(uri)
        return store.delete_uri(uri=u)

    def exists(self, *, uri: str) -> bool:
        store, u = self._route(uri)
        return store.exists(uri=u)

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        store, u = self._route(prefix_uri)
        return store.list_prefix(prefix_uri=u)

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        store, u = self._route(prefix_uri)
        return store.list_objects(prefix_uri=u)

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        store, u = self._route(uri)
        return store.get_to_file(uri=u, dst=dst)

    def put_file(self, *, uri: str, src: Path) -> None:
        store, u = self._route(uri)
        return store.put_file(uri=u, src=src)

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        store, u = self._route(uri)
        return store.put_file_with_metadata(uri=u, src=src, metadata=metadata)


_STORE_SINGLETON: UriStore | None = None


def make_store() -> UriStore:
    """Return the cached default store router for file, S3, and HTTP URIs."""

    global _STORE_SINGLETON
    if _STORE_SINGLETON is None:
        http = HttpStore()
        _STORE_SINGLETON = RoutingStore(
            stores={
                "file": LocalFSStore(),
                "s3": S3Store(),
                "http": http,
                "https": http,
            }
        )
    return _STORE_SINGLETON
