from __future__ import annotations

import gzip
import json
import unittest
from pathlib import Path

from forecast_etl.artifacts.paths import WorkItem
from forecast_etl.artifacts.repository import (
    FIELD_PAYLOAD_METADATA,
    FORECAST_JSON_METADATA,
    INTERNAL_JSON_METADATA,
    LATEST_MANIFEST_METADATA,
    ArtifactRepository,
)
from forecast_etl.storage.base import UriObject, UriWriteMetadata
from forecast_etl.tests.fixtures.artifacts import artifact_marker_payload


class RecordingStore:
    name = "recording"

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.metadata: dict[str, UriWriteMetadata] = {}

    def read_bytes(self, *, uri: str) -> bytes:
        return self.objects[uri]

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        self.objects[uri] = data

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        self.objects[uri] = data
        self.metadata[uri] = metadata

    def exists(self, *, uri: str) -> bool:
        return uri in self.objects

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return sorted(uri for uri in self.objects if uri.startswith(prefix_uri))

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        return [UriObject(uri=uri, size=len(self.objects[uri])) for uri in self.list_prefix(prefix_uri=prefix_uri)]

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        dst.write_bytes(self.objects[uri])

    def put_file(self, *, uri: str, src: Path) -> None:
        self.objects[uri] = src.read_bytes()

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        self.put_file(uri=uri, src=src)
        self.metadata[uri] = metadata


class ArtifactRepositoryTests(unittest.TestCase):
    def test_write_field_payload_gzips_and_sets_forecast_metadata(self) -> None:
        store = RecordingStore()
        repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
        item = WorkItem(
            model_id="gfs",
            cycle="2026042700",
            fhour="003",
            artifact_id="tmp_surface",
            source_uri="file:///dev/null",
        )
        payload = bytes(range(64))

        uri = repo.write_field_payload(item=item, dtype="int8", payload=payload)

        self.assertEqual(gzip.decompress(store.objects[uri]), payload)
        self.assertEqual(store.metadata[uri], FIELD_PAYLOAD_METADATA)

    def test_manifest_and_marker_writes_use_artifact_metadata_profiles(self) -> None:
        store = RecordingStore()
        repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")

        cycle_manifest_uri = repo.write_cycle_manifest(
            model_id="gfs",
            cycle="2026042700",
            manifest={"run": {"cycle": "2026042700"}},
        )
        latest_manifest_uri = repo.write_latest_manifest(
            model_id="gfs",
            manifest={"run": {"cycle": "2026042700"}},
        )
        published_uri = repo.write_published_marker(
            model_id="gfs",
            cycle="2026042700",
            marker={
                "cycle": "2026042700",
                "model": "gfs",
                "generated_at": "2026-04-27T01:00:00+00:00",
                "revision": "abc123",
                "manifest_uri": cycle_manifest_uri,
            },
        )

        self.assertEqual(store.metadata[cycle_manifest_uri], FORECAST_JSON_METADATA)
        self.assertEqual(store.metadata[latest_manifest_uri], LATEST_MANIFEST_METADATA)
        self.assertEqual(store.metadata[published_uri], INTERNAL_JSON_METADATA)

    def test_write_success_marker_builds_and_validates_marker_envelope(self) -> None:
        store = RecordingStore()
        repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
        item = WorkItem(
            model_id="gfs",
            cycle="2026042700",
            fhour="000",
            artifact_id="tmp_surface",
            source_uri="file:///dev/null",
        )

        uri = repo.write_success_marker(
            item=item,
            artifact=artifact_marker_payload(payload_uri="s3://bucket/fields/tmp.bin"),
        )

        stored = json.loads(store.objects[uri].decode("utf-8"))
        self.assertEqual(stored["cycle"], "2026042700")
        self.assertEqual(stored["fhour"], "000")
        self.assertEqual(stored["artifact_id"], "tmp_surface")
        self.assertEqual(stored["artifact"]["payload_uri"], "s3://bucket/fields/tmp.bin")
        self.assertEqual(store.metadata[uri], INTERNAL_JSON_METADATA)

    def test_write_success_marker_rejects_invalid_artifact_payload(self) -> None:
        store = RecordingStore()
        repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
        item = WorkItem(
            model_id="gfs",
            cycle="2026042700",
            fhour="000",
            artifact_id="tmp_surface",
            source_uri="file:///dev/null",
        )

        with self.assertRaises(SystemExit):
            repo.write_success_marker(item=item, artifact={})

        self.assertEqual(store.objects, {})

    def test_missing_success_markers_uses_status_repository_listing(self) -> None:
        store = RecordingStore()
        repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
        item = WorkItem(
            model_id="gfs",
            cycle="2026042700",
            fhour="000",
            artifact_id="tmp_surface",
            source_uri="file:///dev/null",
        )
        repo.write_success_marker(
            item=item,
            artifact=artifact_marker_payload(payload_uri="s3://bucket/fields/tmp.bin"),
        )

        missing = repo.missing_success_markers(
            model_id="gfs",
            cycle="2026042700",
            fhours=("000", "003"),
            artifact_ids=("tmp_surface",),
        )

        self.assertEqual(
            missing,
            ["s3://bucket/artifacts/status/gfs/2026042700/tmp_surface/003._SUCCESS.json"],
        )


if __name__ == "__main__":
    unittest.main()
