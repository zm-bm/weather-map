from __future__ import annotations

from pathlib import Path
from unittest.mock import patch
from urllib.request import Request

import pytest
from weather_etl.storage.base import UriWriteMetadata
from weather_etl.storage.http import HttpStore


class _FakeHttpResponse:
    def __init__(self, payload: bytes = b"", *, status: int = 200) -> None:
        self.payload = payload
        self.status = status
        self._offset = 0

    def __enter__(self) -> _FakeHttpResponse:
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            chunk = self.payload[self._offset :]
            self._offset = len(self.payload)
            return chunk

        chunk = self.payload[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk


class _FakeUrlopen:
    def __init__(self, *responses: _FakeHttpResponse | Exception) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[Request, float | None]] = []

    def __call__(self, request: Request, *, timeout: float | None = None):
        self.calls.append((request, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_http_store_read_bytes_uses_timeout() -> None:
    opener = _FakeUrlopen(_FakeHttpResponse(b'{"ok":true}'))
    store = HttpStore(timeout_seconds=12)

    with patch("weather_etl.storage.http.urlopen", opener):
        payload = store.read_bytes(uri="https://example.test/config.json")

    request, timeout = opener.calls[0]
    assert payload == b'{"ok":true}'
    assert request.get_method() == "GET"
    assert timeout == 12


def test_http_store_exists_uses_head_with_timeout() -> None:
    opener = _FakeUrlopen(_FakeHttpResponse(status=204))
    store = HttpStore(timeout_seconds=30)

    with patch("weather_etl.storage.http.urlopen", opener):
        assert store.exists(uri="http://example.test/catalog.json")

    request, timeout = opener.calls[0]
    assert request.get_method() == "HEAD"
    assert timeout == 30


def test_http_store_exists_falls_back_to_range_get() -> None:
    opener = _FakeUrlopen(OSError("HEAD unsupported"), _FakeHttpResponse(status=206))
    store = HttpStore(timeout_seconds=45)

    with patch("weather_etl.storage.http.urlopen", opener):
        assert store.exists(uri="https://example.test/catalog.json")

    methods = [request.get_method() for request, _timeout in opener.calls]
    assert methods == ["HEAD", "GET"]
    assert opener.calls[1][0].get_header("Range") == "bytes=0-0"
    assert [timeout for _request, timeout in opener.calls] == [45, 45]


def test_http_store_exists_returns_false_when_head_and_get_fail() -> None:
    opener = _FakeUrlopen(OSError("HEAD unsupported"), OSError("GET failed"))
    store = HttpStore()

    with patch("weather_etl.storage.http.urlopen", opener):
        assert not store.exists(uri="https://example.test/missing.json")


def test_http_store_get_to_file_uses_timeout(tmp_path: Path) -> None:
    opener = _FakeUrlopen(_FakeHttpResponse(b"downloaded"))
    store = HttpStore(timeout_seconds=15)
    dst = tmp_path / "download.bin"

    with patch("weather_etl.storage.http.urlopen", opener):
        store.get_to_file(uri="https://example.test/download.bin", dst=dst)

    request, timeout = opener.calls[0]
    assert dst.read_bytes() == b"downloaded"
    assert request.get_method() == "GET"
    assert timeout == 15


@pytest.mark.parametrize("uri", ("ftp://example.test/file", "https:///missing-host"))
def test_http_store_rejects_non_http_or_hostless_uris(uri: str) -> None:
    store = HttpStore()

    with pytest.raises(ValueError, match="Unsupported URI scheme"):
        store.read_bytes(uri=uri)


def test_http_store_is_read_only(tmp_path: Path) -> None:
    store = HttpStore()
    src = tmp_path / "src.bin"
    src.write_bytes(b"payload")

    with pytest.raises(NotImplementedError):
        store.write_bytes(uri="https://example.test/object", data=b"payload")
    with pytest.raises(NotImplementedError):
        store.write_bytes_with_metadata(
            uri="https://example.test/object",
            data=b"payload",
            metadata=UriWriteMetadata(content_type="application/octet-stream"),
        )
    with pytest.raises(NotImplementedError):
        store.delete_uri(uri="https://example.test/object")
    with pytest.raises(NotImplementedError):
        store.list_prefix(prefix_uri="https://example.test/")
    with pytest.raises(NotImplementedError):
        store.list_objects(prefix_uri="https://example.test/")
    with pytest.raises(NotImplementedError):
        store.put_file(uri="https://example.test/object", src=src)
    with pytest.raises(NotImplementedError):
        store.put_file_with_metadata(uri="https://example.test/object", src=src, metadata=UriWriteMetadata())
