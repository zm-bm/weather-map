from __future__ import annotations

from pathlib import Path

import pytest
from weather_etl.storage.uris import file_uri, join_uri, normalize_resource_uri, path_from_file_uri


@pytest.mark.parametrize(
    ("root_uri", "parts", "expected"),
    (
        ("file:///tmp/artifacts", ["status", "gfs"], "file:///tmp/artifacts/status/gfs"),
        ("file:///tmp/artifacts/", ["/status/", "gfs"], "file:///tmp/artifacts/status/gfs"),
        ("/tmp/artifacts", ["status", "gfs"], "file:///tmp/artifacts/status/gfs"),
        ("s3://bucket", ["manifests", "icon"], "s3://bucket/manifests/icon"),
        ("s3://bucket/prefix", ["manifests", "icon"], "s3://bucket/prefix/manifests/icon"),
    ),
)
def test_join_uri_supports_file_and_s3_roots(root_uri: str, parts: list[str], expected: str) -> None:
    assert join_uri(root_uri, parts) == expected


def test_file_uri_returns_canonical_escaped_file_uri(tmp_path: Path) -> None:
    path = tmp_path / "space dir" / "artifact.json"

    assert file_uri(path).startswith("file:///")
    assert "space%20dir" in file_uri(path)
    assert path_from_file_uri(file_uri(path)) == path


def test_normalize_resource_uri_accepts_bare_local_paths(tmp_path: Path) -> None:
    path = tmp_path / "artifact.json"

    assert normalize_resource_uri(path.as_posix(), allowed_schemes=("file", "s3")) == path.as_uri()


@pytest.mark.parametrize(
    ("uri", "allowed_schemes"),
    (
        ("s3://bucket/key.json", ("file", "s3")),
        ("https://example.test/config.json?version=1", ("file", "https")),
    ),
)
def test_normalize_resource_uri_preserves_remote_uris(uri: str, allowed_schemes: tuple[str, ...]) -> None:
    assert normalize_resource_uri(uri, allowed_schemes=allowed_schemes) == uri


def test_normalize_resource_uri_rejects_unsupported_schemes() -> None:
    with pytest.raises(SystemExit):
        normalize_resource_uri("https://example.test/config.json", allowed_schemes=("file", "s3"))


def test_path_from_file_uri_supports_canonical_local_file_uri(tmp_path: Path) -> None:
    path = tmp_path / "artifact.json"

    assert path_from_file_uri(path.as_uri()) == path
    assert path_from_file_uri("file://localhost" + path.as_posix()) == path


@pytest.mark.parametrize(
    "uri",
    (
        "file://" + "relative/path",
        "file:" + "/relative/path",
        "file://remote-host/tmp/artifact.json",
        "file:///tmp/artifact.json?download=1",
        "file:///tmp/artifact.json#section",
        "s3://bucket/key",
    ),
)
def test_path_from_file_uri_rejects_noncanonical_or_nonlocal_uris(uri: str) -> None:
    with pytest.raises(SystemExit):
        path_from_file_uri(uri)
