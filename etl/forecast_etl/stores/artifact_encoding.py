"""HTTP representation helpers for published artifacts."""

from __future__ import annotations

import gzip
from pathlib import PurePosixPath

FIELD_PAYLOAD_SUFFIXES = (".bin",)


def is_gzip_encoded_artifact_key(*, key: str) -> bool:
    normalized_key = key.lower()
    return normalized_key.endswith(FIELD_PAYLOAD_SUFFIXES) and "fields" in PurePosixPath(normalized_key).parts


def encode_artifact_body(*, key: str, data: bytes) -> bytes:
    if not is_gzip_encoded_artifact_key(key=key):
        return data
    return gzip.compress(data, mtime=0)
