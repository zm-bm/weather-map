from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

import pytest
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.state.artifacts.identity import ArtifactWorkItem
from weather_etl.state.artifacts.repository import (
    CACHEABLE_JSON_METADATA,
    INTERNAL_JSON_METADATA,
    PAYLOAD_METADATA,
    PUBLIC_MANIFEST_JSON_METADATA,
    ArtifactRepository,
)
from weather_etl.state.manifest.schema import CycleManifest, parse_cycle_manifest
from weather_etl.state.runs.metadata import RunMetadata, RunSnapshot
from weather_etl.storage.base import UriObject, UriWriteMetadata

from tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_PRODUCT_CONFIG_DIGEST,
    DEFAULT_RUN_ID,
    artifact_marker_payload,
)
from tests.fixtures.manifests import cycle_manifest_dict
from tests.fixtures.pipeline import minimal_pipeline_config


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


def test_write_payload_gzips_and_sets_payload_metadata() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    item = _work_item(frame_id="003")
    payload = bytes(range(64))

    uri = repo.write_payload(item=item, dtype="int8", payload=payload)

    assert gzip.decompress(store.objects[uri]) == payload
    assert store.metadata[uri] == PAYLOAD_METADATA


def test_json_writes_use_expected_metadata_profiles() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    manifest = _cycle_manifest()

    public_manifest_uri = repo.write_public_run_manifest(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        manifest=manifest,
    )
    current_manifest_uri = repo.write_cycle_current_manifest(
        dataset_id="gfs",
        cycle="2026042700",
        manifest=manifest,
    )
    latest_manifest_uri = repo.write_latest_manifest(dataset_id="gfs", manifest=manifest)
    validation_uri = repo.write_validation_report(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        report={"status": "passed"},
    )
    publication_uri = repo.write_publication(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        marker=_publication_marker(repo=repo, public_manifest_uri=public_manifest_uri),
    )
    status_uri = repo.write_status_document(document={"schema": "weather-map.etl-status"})

    assert store.metadata[public_manifest_uri] == CACHEABLE_JSON_METADATA
    assert store.metadata[current_manifest_uri] == PUBLIC_MANIFEST_JSON_METADATA
    assert store.metadata[latest_manifest_uri] == PUBLIC_MANIFEST_JSON_METADATA
    assert store.metadata[validation_uri] == INTERNAL_JSON_METADATA
    assert store.metadata[publication_uri] == INTERNAL_JSON_METADATA
    assert store.metadata[status_uri] == PUBLIC_MANIFEST_JSON_METADATA


def test_status_document_round_trips_at_root() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")

    uri = repo.write_status_document(
        document={
            "schema": "weather-map.etl-status",
            "schema_version": 1,
            "ok": True,
        }
    )

    assert uri == "s3://bucket/artifacts/status.json"
    assert uri in store.objects
    assert json.loads(store.objects[uri].decode("utf-8"))["schema"] == "weather-map.etl-status"


def test_public_run_manifest_is_immutable() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    manifest = _cycle_manifest()

    repo.write_public_run_manifest(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        manifest=manifest,
    )
    repo.write_public_run_manifest(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        manifest=manifest,
    )
    read_manifest = repo.read_public_run_manifest(dataset_id="gfs", cycle="2026042700", run_id=DEFAULT_RUN_ID)

    conflicting = _cycle_manifest(revision="other")
    with pytest.raises(SystemExit, match="Existing immutable run object conflicts"):
        repo.write_public_run_manifest(
            dataset_id="gfs",
            cycle="2026042700",
            run_id=DEFAULT_RUN_ID,
            manifest=conflicting,
        )

    assert read_manifest.revision == "abc123"


def test_public_run_manifest_validates_path_identity() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")

    with pytest.raises(SystemExit, match="public run manifest run_id mismatch"):
        repo.write_public_run_manifest(
            dataset_id="gfs",
            cycle="2026042700",
            run_id="20260411T010000Z-00000000",
            manifest=_cycle_manifest(),
        )


def test_write_success_marker_builds_and_validates_marker_envelope() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    item = _work_item(
        frame_id="000",
        code_revision=DEFAULT_CODE_REVISION,
        image_identity=DEFAULT_IMAGE_IDENTITY,
        product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
    )

    uri = repo.write_success_marker(
        item=item,
        artifact=artifact_marker_payload(
            payload_uri=(
                "s3://bucket/artifacts/runs/gfs/2026042700/"
                f"{DEFAULT_RUN_ID}/payloads/000/tmp_surface.i8.bin"
            )
        ),
    )

    stored = json.loads(store.objects[uri].decode("utf-8"))
    assert stored["schema"] == "weather-map.etl-artifact-success"
    assert stored["schema_version"] == 2
    assert stored["cycle"] == "2026042700"
    assert stored["dataset_id"] == "gfs"
    assert stored["run_id"] == DEFAULT_RUN_ID
    assert stored["frame_id"] == "000"
    assert stored["artifact_id"] == "tmp_surface"
    assert stored["generated_at"]
    assert stored["code_revision"] == DEFAULT_CODE_REVISION
    assert stored["image_identity"] == DEFAULT_IMAGE_IDENTITY
    assert stored["product_config_digest"] == DEFAULT_PRODUCT_CONFIG_DIGEST
    assert stored["artifact"]["payload_uri"] == (
        f"s3://bucket/artifacts/runs/gfs/2026042700/{DEFAULT_RUN_ID}/payloads/000/tmp_surface.i8.bin"
    )
    assert store.metadata[uri] == INTERNAL_JSON_METADATA


def test_write_success_marker_rejects_invalid_artifact_payload() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")

    with pytest.raises(SystemExit):
        repo.write_success_marker(item=_work_item(frame_id="000"), artifact={})

    assert store.objects == {}


def test_write_publication_validates_marker_before_write() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")

    with pytest.raises(SystemExit, match="Invalid run publication"):
        repo.write_publication(
            dataset_id="gfs",
            cycle="2026042700",
            run_id=DEFAULT_RUN_ID,
            marker={
                "schema": "weather-map.etl-run-publication",
                "schema_version": 1,
                "cycle": "2026042700",
                "dataset_id": "gfs",
                "run_id": DEFAULT_RUN_ID,
                "generated_at": "2026-04-27T01:00:00+00:00",
                "revision": "abc123",
                "manifest_path": "/absolute/path.json",
            },
        )

    assert store.objects == {}


def test_ensure_run_snapshot_writes_immutable_run_metadata_and_snapshots() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    snapshot = _run_snapshot()

    run_uri = repo.ensure_run_snapshot(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        snapshot=snapshot,
    )
    repo.ensure_run_snapshot(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        snapshot=snapshot,
    )

    assert run_uri == f"s3://bucket/artifacts/runs/gfs/2026042700/{DEFAULT_RUN_ID}/run.json"
    run_doc = json.loads(store.objects[run_uri].decode("utf-8"))
    assert run_doc["run_id"] == DEFAULT_RUN_ID
    assert run_doc["schema_version"] == 5
    assert run_doc["created_at"] == "2026-04-11T00:00:00Z"
    assert run_doc["product_config_digest"] == DEFAULT_PRODUCT_CONFIG_DIGEST
    assert f"s3://bucket/artifacts/runs/gfs/2026042700/{DEFAULT_RUN_ID}/config/pipeline.json" in store.objects
    assert f"s3://bucket/artifacts/runs/gfs/2026042700/{DEFAULT_RUN_ID}/config/catalog.json" in store.objects


def test_ensure_run_snapshot_rejects_conflicting_existing_metadata() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    snapshot = _run_snapshot()
    repo.ensure_run_snapshot(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        snapshot=snapshot,
    )
    conflicting = RunSnapshot(
        metadata=RunMetadata(
            code_revision="other",
            image_identity=DEFAULT_IMAGE_IDENTITY,
            product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        ),
        pipeline=snapshot.pipeline,
        catalog=snapshot.catalog,
    )

    with pytest.raises(SystemExit):
        repo.ensure_run_snapshot(
            dataset_id="gfs",
            cycle="2026042700",
            run_id=DEFAULT_RUN_ID,
            snapshot=conflicting,
        )


def test_missing_success_markers_uses_status_repository_listing() -> None:
    store = RecordingStore()
    repo = ArtifactRepository.for_root(store=store, artifact_root_uri="s3://bucket/artifacts")
    repo.write_success_marker(
        item=_work_item(frame_id="000"),
        artifact=artifact_marker_payload(
            payload_uri=(
                "s3://bucket/artifacts/runs/gfs/2026042700/"
                f"{DEFAULT_RUN_ID}/payloads/000/tmp_surface.i8.bin"
            )
        ),
    )

    missing = repo.missing_success_markers(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        frames=("000", "003"),
        artifact_ids=("tmp_surface",),
    )

    assert missing == [
        "s3://bucket/artifacts/"
        f"runs/gfs/2026042700/{DEFAULT_RUN_ID}/status/tmp_surface/003._SUCCESS.json"
    ]


def _work_item(
    *,
    frame_id: str,
    code_revision: str = "unknown",
    image_identity: str = "unknown",
    product_config_digest: str = DEFAULT_PRODUCT_CONFIG_DIGEST,
) -> ArtifactWorkItem:
    return ArtifactWorkItem(
        dataset_id="gfs",
        cycle="2026042700",
        run_id=DEFAULT_RUN_ID,
        frame_id=frame_id,
        artifact_id="tmp_surface",
        source_uri="file:///dev/null",
        code_revision=code_revision,
        image_identity=image_identity,
        product_config_digest=product_config_digest,
    )


def _cycle_manifest(*, revision: str = "abc123") -> CycleManifest:
    dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")
    return parse_cycle_manifest(
        cycle_manifest_dict(
            dataset,
            cycle="2026042700",
            artifact_ids=("tmp_surface",),
            frames=("000",),
            generated_at="2026-04-27T01:00:00+00:00",
            revision=revision,
        )
    )


def _publication_marker(*, repo: ArtifactRepository, public_manifest_uri: str) -> dict[str, Any]:
    return {
        "schema": "weather-map.etl-run-publication",
        "schema_version": 1,
        "cycle": "2026042700",
        "dataset_id": "gfs",
        "run_id": DEFAULT_RUN_ID,
        "generated_at": "2026-04-27T01:00:00+00:00",
        "revision": "abc123",
        "manifest_path": repo.paths.relative_key(public_manifest_uri),
    }


def _run_snapshot() -> RunSnapshot:
    return RunSnapshot(
        metadata=RunMetadata(
            code_revision=DEFAULT_CODE_REVISION,
            image_identity=DEFAULT_IMAGE_IDENTITY,
            product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        ),
        pipeline={"datasets": {"gfs": {}}},
        catalog={"catalogVersion": "test"},
    )
