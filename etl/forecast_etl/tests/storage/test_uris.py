from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from forecast_etl.uris import join_uri, path_from_file_uri


class UriHelpersTest(unittest.TestCase):
    def test_join_uri_supports_file_and_s3_roots(self) -> None:
        self.assertEqual(join_uri("file:///tmp/artifacts", ["status", "gfs"]), "file:///tmp/artifacts/status/gfs")
        self.assertEqual(join_uri("s3://bucket/prefix", ["manifests", "icon"]), "s3://bucket/prefix/manifests/icon")

    def test_path_from_file_uri_supports_standard_file_uri(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "artifact.json"
            self.assertEqual(path_from_file_uri(path.as_uri()), path)


if __name__ == "__main__":
    unittest.main()
