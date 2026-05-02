"""Storage interfaces.

The ETL pipeline routes all I/O through `UriStore` so the same code can operate
against local disk, S3, or read-only HTTP sources.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol


class UriStore(Protocol):
    """Abstract interface for reading/writing URI-addressed objects."""

    name: str

    def read_bytes(self, *, uri: str) -> bytes:
        """Read an entire object as bytes."""
        ...

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        """Write bytes atomically where possible."""
        ...

    def exists(self, *, uri: str) -> bool:
        """Return True if the object exists."""
        ...

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        """List object URIs under a prefix URI."""
        ...

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        """Materialize a URI to a local file path."""
        ...

    def put_file(self, *, uri: str, src: Path) -> None:
        """Upload/copy a local file to a URI."""
        ...
