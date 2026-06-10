"""HTTP(S) URI store.

Supports `http://` and `https://` URIs.

This is intended for reading/downloading upstream inputs.
Writing/listing is not supported.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .base import UriObject, UriStore, UriWriteMetadata

DEFAULT_HTTP_TIMEOUT_SECONDS = 60


@dataclass(frozen=True)
class HttpStore(UriStore):
    """Read-only URI store implementation for HTTP and HTTPS inputs."""

    name: str = "http"
    timeout_seconds: float = DEFAULT_HTTP_TIMEOUT_SECONDS

    def _check_scheme(self, uri: str) -> None:
        parsed = urlparse(uri)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"Unsupported URI scheme for HttpStore: {uri}")

    def read_bytes(self, *, uri: str) -> bytes:
        self._check_scheme(uri)
        req = Request(uri, method="GET")
        with urlopen(req, timeout=self.timeout_seconds) as resp:
            return resp.read()

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        raise NotImplementedError("HttpStore is read-only")

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        raise NotImplementedError("HttpStore is read-only")

    def delete_uri(self, *, uri: str) -> None:
        raise NotImplementedError("HttpStore is read-only")

    def exists(self, *, uri: str) -> bool:
        self._check_scheme(uri)
        try:
            req = Request(uri, method="HEAD")
            with urlopen(req, timeout=self.timeout_seconds) as resp:
                return 200 <= int(getattr(resp, "status", 200)) < 400
        except Exception:
            # Some servers don't support HEAD; fall back to a tiny range GET.
            try:
                req = Request(uri, method="GET", headers={"Range": "bytes=0-0"})
                with urlopen(req, timeout=self.timeout_seconds) as resp:
                    return 200 <= int(getattr(resp, "status", 200)) < 400
            except Exception:
                return False

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        raise NotImplementedError("HttpStore does not support list_prefix")

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        raise NotImplementedError("HttpStore does not support list_objects")

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        self._check_scheme(uri)
        dst.parent.mkdir(parents=True, exist_ok=True)
        tmp = dst.with_suffix(dst.suffix + ".tmp")

        req = Request(uri, method="GET")
        try:
            with urlopen(req, timeout=self.timeout_seconds) as resp:
                with open(tmp, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
            tmp.replace(dst)
        finally:
            if tmp.exists() and not dst.exists():
                tmp.unlink(missing_ok=True)

    def put_file(self, *, uri: str, src: Path) -> None:
        raise NotImplementedError("HttpStore is read-only")

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        raise NotImplementedError("HttpStore is read-only")
