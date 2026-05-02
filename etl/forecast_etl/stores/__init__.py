"""URI-based storage abstraction.

The ETL pipeline reads inputs and publishes artifacts via a simple `UriStore`
protocol. A `RoutingStore` dispatches operations based on the URI scheme.

Supported schemes:
- `file://` (local filesystem)
- `s3://` (AWS S3)
- `http(s)://` (read-only)
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlparse

from .base import UriStore
from .http import HttpStore
from .local_fs import LocalFSStore
from .s3 import S3Store


@dataclass(frozen=True)
class RoutingStore(UriStore):
    """Dispatch URI store calls by URI scheme.

    Use this when inputs/outputs may live on different schemes.
    """

    stores: Mapping[str, UriStore]
    default_scheme: str = "file"
    name: str = "router"

    def _route(self, uri: str) -> tuple[UriStore, str]:
        parsed = urlparse(uri)
        scheme = parsed.scheme or self.default_scheme

        store = self.stores.get(scheme)
        if store is None:
            raise ValueError(f"Unsupported URI scheme: {scheme!r} (uri={uri!r})")

        # If caller passed a bare filesystem path, normalize to file://... URI
        if not parsed.scheme and scheme == "file":
            p = Path(uri).expanduser()
            # Preserve "directory-ish" intent for prefixes
            wants_trailing_slash = uri.endswith(("/", "/."))
            file_uri = p.resolve().as_uri()
            if wants_trailing_slash and not file_uri.endswith("/"):
                file_uri += "/"
            return store, file_uri

        return store, uri

    def read_bytes(self, *, uri: str) -> bytes:
        store, u = self._route(uri)
        return store.read_bytes(uri=u)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        store, u = self._route(uri)
        return store.write_bytes(uri=u, data=data)

    def exists(self, *, uri: str) -> bool:
        store, u = self._route(uri)
        return store.exists(uri=u)

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        store, u = self._route(prefix_uri)
        return store.list_prefix(prefix_uri=u)

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        store, u = self._route(uri)
        return store.get_to_file(uri=u, dst=dst)

    def put_file(self, *, uri: str, src: Path) -> None:
        store, u = self._route(uri)
        return store.put_file(uri=u, src=src)


_STORE_SINGLETON: UriStore | None = None


def make_store() -> UriStore:
    """Return the default URI store (cached singleton)."""

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
