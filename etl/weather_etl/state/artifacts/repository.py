"""Artifact repository boundary for weather ETL storage."""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from ...core.cycles import validate_cycle_id
from ...core.timestamps import utc_now_iso
from ...storage.base import UriObject, UriStore, UriWriteMetadata
from ..manifest.schema import CycleManifest, parse_cycle_manifest
from ..runs.ids import validate_run_id
from ..runs.metadata import RunSnapshot, run_document_dict
from .identity import ArtifactWorkItem
from .markers_schema import (
    SUCCESS_MARKER_SCHEMA,
    SUCCESS_MARKER_SCHEMA_VERSION,
    ArtifactSuccessMarker,
    parse_artifact_success_marker,
    stored_artifact_success_marker_dict,
)
from .paths import SUCCESS_MARKER_SUFFIX, ArtifactPaths
from .publication_schema import RunPublicationMarker, parse_run_publication

PUBLIC_MANIFEST_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=60"
CACHEABLE_ARTIFACT_CACHE_CONTROL = "public, max-age=3600, s-maxage=21600, stale-while-revalidate=300"
INTERNAL_ARTIFACT_CACHE_CONTROL = "private, no-store"

PAYLOAD_METADATA = UriWriteMetadata(
    content_type="application/octet-stream",
    cache_control=CACHEABLE_ARTIFACT_CACHE_CONTROL,
    content_encoding="gzip",
)
CACHEABLE_JSON_METADATA = UriWriteMetadata(
    content_type="application/json",
    cache_control=CACHEABLE_ARTIFACT_CACHE_CONTROL,
)
PUBLIC_MANIFEST_JSON_METADATA = UriWriteMetadata(
    content_type="application/json",
    cache_control=PUBLIC_MANIFEST_CACHE_CONTROL,
)
INTERNAL_JSON_METADATA = UriWriteMetadata(
    content_type="application/json",
    cache_control=INTERNAL_ARTIFACT_CACHE_CONTROL,
)


@dataclass(frozen=True)
class ArtifactRepository:
    """Read and write artifacts with artifact-specific storage policy."""

    store: UriStore
    paths: ArtifactPaths

    @classmethod
    def for_root(cls, *, store: UriStore, artifact_root_uri: str) -> "ArtifactRepository":
        return cls(store=store, paths=ArtifactPaths(artifact_root_uri))

    # Payloads and artifact success markers.

    def write_payload(self, *, item: ArtifactWorkItem, dtype: str, payload: bytes) -> str:
        """Write one encoded payload and return its artifact URI."""

        uri = self.paths.payload_uri(item, dtype=dtype)
        self._write_bytes(uri=uri, data=gzip.compress(payload, mtime=0), metadata=PAYLOAD_METADATA)
        return uri

    def write_success_marker(self, *, item: ArtifactWorkItem, artifact: Mapping[str, Any]) -> str:
        """Write one artifact success marker and return its artifact URI."""

        uri = self.paths.success_marker_uri(item)
        marker = stored_artifact_success_marker_dict({
            "schema": SUCCESS_MARKER_SCHEMA,
            "schema_version": SUCCESS_MARKER_SCHEMA_VERSION,
            "dataset_id": item.dataset_id,
            "cycle": item.cycle,
            "run_id": item.run_id,
            "frame_id": item.frame_id,
            "artifact_id": item.artifact_id,
            "generated_at": utc_now_iso(),
            "code_revision": item.code_revision,
            "image_identity": item.image_identity,
            "product_config_digest": item.product_config_digest,
            "artifact": dict(artifact),
        })
        self._write_json(uri=uri, obj=marker, metadata=INTERNAL_JSON_METADATA, indent=None)
        return uri

    def read_artifact_success_marker(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_id: str,
    ) -> ArtifactSuccessMarker:
        """Read and validate one artifact success marker."""

        uri = self.paths.success_marker_uri_parts(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            artifact_id=artifact_id,
        )
        return self.read_artifact_success_marker_uri(uri)

    def read_artifact_success_marker_uri(self, uri: str) -> ArtifactSuccessMarker:
        """Read and validate one artifact success marker by URI."""

        return parse_artifact_success_marker(self.read_json_uri(uri), uri=uri)

    def read_json_uri(self, uri: str) -> dict[str, Any]:
        """Read a JSON artifact by exact URI."""

        return self._read_json(uri=uri)

    # Run snapshots, listings, and deletion.

    def ensure_run_snapshot(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        snapshot: RunSnapshot,
    ) -> str:
        """Write or verify immutable run metadata and config/catalog snapshots."""

        run_uri = self.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        pipeline_uri = self.paths.run_pipeline_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        catalog_uri = self.paths.run_catalog_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        run_doc = run_document_dict(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            metadata=snapshot.metadata,
        )

        self._write_json_once_or_same(uri=pipeline_uri, obj=snapshot.pipeline)
        self._write_json_once_or_same(uri=catalog_uri, obj=snapshot.catalog)
        self._write_json_once_or_same(uri=run_uri, obj=run_doc)
        return run_uri

    def list_run_ids(self, *, dataset_id: str, cycle: str) -> tuple[str, ...]:
        """List known run ids for one dataset cycle."""

        prefix = self.paths.cycle_runs_prefix_uri(dataset_id=dataset_id, cycle=cycle)
        run_ids: set[str] = set()
        for uri in self.store.list_prefix(prefix_uri=prefix):
            try:
                key = self.paths.relative_key(uri)
            except ValueError:
                continue
            parts = key.split("/")
            if len(parts) >= 4 and parts[:3] == ["runs", dataset_id, cycle]:
                try:
                    run_ids.add(validate_run_id(parts[3]))
                except ValueError:
                    continue
        return tuple(sorted(run_ids))

    def list_run_cycles(self, *, dataset_id: str) -> tuple[str, ...]:
        """List known cycles with run-scoped objects for one dataset."""

        prefix = self.paths.dataset_runs_prefix_uri(dataset_id=dataset_id)
        cycles: set[str] = set()
        for uri in self.store.list_prefix(prefix_uri=prefix):
            try:
                key = self.paths.relative_key(uri)
            except ValueError:
                continue
            parts = key.split("/")
            if len(parts) >= 3 and parts[:2] == ["runs", dataset_id]:
                try:
                    cycles.add(validate_cycle_id(parts[2]))
                except ValueError:
                    continue
        return tuple(sorted(cycles))

    def list_success_marker_uris(self, *, dataset_id: str, cycle: str, run_id: str) -> set[str]:
        """List artifact success marker URIs for one run."""

        prefix = self.paths.status_prefix_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return {uri for uri in self.store.list_prefix(prefix_uri=prefix) if uri.endswith(SUCCESS_MARKER_SUFFIX)}

    def list_status_objects(self, *, dataset_id: str, cycle: str, run_id: str) -> list[UriObject]:
        """List status artifact objects for one run."""

        return self.store.list_objects(prefix_uri=self.paths.status_prefix_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def list_cycle_run_objects(self, *, dataset_id: str, cycle: str) -> list[UriObject]:
        """List all run-scoped objects for one dataset cycle."""

        return self.store.list_objects(prefix_uri=self.paths.cycle_runs_prefix_uri(dataset_id=dataset_id, cycle=cycle))

    def missing_success_markers(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frames: Iterable[str],
        artifact_ids: Iterable[str],
    ) -> list[str]:
        """Return expected artifact success markers missing from storage."""

        existing = self.list_success_marker_uris(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        expected = {
            self.paths.success_marker_uri_parts(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
            )
            for artifact_id in artifact_ids
            for frame_id in frames
        }
        return sorted(expected - existing)

    # Validation reports and canonical internal run manifests.

    def write_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str, manifest: CycleManifest) -> str:
        """Write the canonical internal run manifest and return its artifact URI."""

        uri = self.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        obj = self._stored_public_manifest(
            manifest,
            uri=uri,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            label="run manifest",
        )
        self._write_json(uri=uri, obj=obj, metadata=CACHEABLE_JSON_METADATA)
        return uri

    def read_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str) -> CycleManifest:
        """Read the canonical internal run manifest."""

        uri = self.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return self._parse_public_manifest(
            self._read_json(uri=uri),
            uri=uri,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            label="run manifest",
        )

    def run_manifest_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether the canonical internal run manifest exists."""

        return self.store.exists(uri=self.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def write_validation_report(self, *, dataset_id: str, cycle: str, run_id: str, report: Mapping[str, Any]) -> str:
        """Write one run validation report and return its artifact URI."""

        uri = self.paths.validation_report_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        self._write_json(uri=uri, obj=dict(report), metadata=INTERNAL_JSON_METADATA)
        return uri

    def read_validation_report(self, *, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
        """Read one run validation report."""

        return self._read_json(uri=self.paths.validation_report_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def validation_report_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether one run validation report exists."""

        return self.store.exists(uri=self.paths.validation_report_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    # Public manifests and manifest index.

    def write_public_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str, manifest: CycleManifest) -> str:
        """Write or verify the immutable public run manifest."""

        uri = self.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        obj = self._stored_public_manifest(
            manifest,
            uri=uri,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            label="public run manifest",
        )
        self._write_json_once_or_same(uri=uri, obj=obj, metadata=CACHEABLE_JSON_METADATA)
        return uri

    def read_public_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str) -> CycleManifest:
        """Read one immutable public run manifest."""

        uri = self.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return self._parse_public_manifest(
            self._read_json(uri=uri),
            uri=uri,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            label="public run manifest",
        )

    def public_run_manifest_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether one immutable public run manifest exists."""

        return self.store.exists(uri=self.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def write_cycle_current_manifest(self, *, dataset_id: str, cycle: str, manifest: CycleManifest) -> str:
        """Write the current public manifest for one dataset cycle."""

        uri = self.paths.cycle_current_manifest_uri(dataset_id=dataset_id, cycle=cycle)
        obj = self._stored_public_manifest(
            manifest,
            uri=uri,
            dataset_id=dataset_id,
            cycle=cycle,
            label="current manifest",
        )
        self._write_json(uri=uri, obj=obj, metadata=PUBLIC_MANIFEST_JSON_METADATA)
        return uri

    def read_cycle_current_manifest(self, *, dataset_id: str, cycle: str) -> CycleManifest:
        """Read the current public manifest for one dataset cycle."""

        uri = self.paths.cycle_current_manifest_uri(dataset_id=dataset_id, cycle=cycle)
        return self._parse_public_manifest(
            self._read_json(uri=uri),
            uri=uri,
            dataset_id=dataset_id,
            cycle=cycle,
            label="current manifest",
        )

    def cycle_current_manifest_exists(self, *, dataset_id: str, cycle: str) -> bool:
        """Return whether the current public manifest for one dataset cycle exists."""

        return self.store.exists(uri=self.paths.cycle_current_manifest_uri(dataset_id=dataset_id, cycle=cycle))

    def write_latest_manifest(self, *, dataset_id: str, manifest: CycleManifest) -> str:
        """Write the latest public manifest and return its artifact URI."""

        uri = self.paths.latest_manifest_uri(dataset_id=dataset_id)
        obj = self._stored_public_manifest(
            manifest,
            uri=uri,
            dataset_id=dataset_id,
            label="latest manifest",
        )
        self._write_json(uri=uri, obj=obj, metadata=PUBLIC_MANIFEST_JSON_METADATA)
        return uri

    def read_latest_manifest(self, *, dataset_id: str) -> CycleManifest:
        """Read the latest public manifest."""

        uri = self.paths.latest_manifest_uri(dataset_id=dataset_id)
        return self._parse_public_manifest(
            self._read_json(uri=uri),
            uri=uri,
            dataset_id=dataset_id,
            label="latest manifest",
        )

    def latest_manifest_exists(self, *, dataset_id: str) -> bool:
        """Return whether the latest public manifest exists."""

        return self.store.exists(uri=self.paths.latest_manifest_uri(dataset_id=dataset_id))

    def write_manifest_index(self, *, manifest: Mapping[str, Any]) -> str:
        """Write the frontend manifest index and return its artifact URI."""

        uri = self.paths.manifest_index_uri()
        self._write_json(uri=uri, obj=dict(manifest), metadata=PUBLIC_MANIFEST_JSON_METADATA)
        return uri

    def read_manifest_index(self) -> dict[str, Any]:
        """Read the frontend manifest index."""

        return self._read_json(uri=self.paths.manifest_index_uri())

    def manifest_index_exists(self) -> bool:
        """Return whether the frontend manifest index exists."""

        return self.store.exists(uri=self.paths.manifest_index_uri())

    # Public ETL status document.

    def write_status_document(self, *, document: Mapping[str, Any]) -> str:
        """Write the public ETL status document and return its artifact URI."""

        uri = self.paths.status_uri()
        self._write_json(uri=uri, obj=dict(document), metadata=PUBLIC_MANIFEST_JSON_METADATA)
        return uri

    def list_manifest_objects(self, *, dataset_id: str) -> list[UriObject]:
        """List manifest objects for a dataset."""

        return self.store.list_objects(prefix_uri=self.paths.manifest_prefix_uri(dataset_id=dataset_id))

    # Run publication marker.

    def write_publication(self, *, dataset_id: str, cycle: str, run_id: str, marker: Mapping[str, Any]) -> str:
        """Write the publication marker and return its artifact URI."""

        uri = self.paths.publication_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        publication = parse_run_publication(marker, uri=uri)
        self._write_json(
            uri=uri,
            obj=publication.model_dump(by_alias=True, mode="json"),
            metadata=INTERNAL_JSON_METADATA,
        )
        return uri

    def read_publication(self, *, dataset_id: str, cycle: str, run_id: str) -> RunPublicationMarker:
        """Read and validate the publication marker for a run."""

        uri = self.paths.publication_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return parse_run_publication(self._read_json(uri=uri), uri=uri)

    def publication_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether the publication marker exists."""

        return self.store.exists(uri=self.paths.publication_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    # Private storage helpers.

    def _read_json(self, *, uri: str) -> dict[str, Any]:
        data = self.store.read_bytes(uri=uri)
        return json.loads(data.decode("utf-8"))

    def _write_json(
        self,
        *,
        uri: str,
        obj: Mapping[str, Any],
        metadata: UriWriteMetadata,
        indent: int | None = 2,
    ) -> None:
        if indent is not None:
            json_text = json.dumps(obj, sort_keys=True, indent=indent)
        else:
            json_text = json.dumps(obj, sort_keys=True)
        self._write_bytes(uri=uri, data=(json_text + "\n").encode("utf-8"), metadata=metadata)

    def _write_json_once_or_same(
        self,
        *,
        uri: str,
        obj: Mapping[str, Any],
        metadata: UriWriteMetadata = INTERNAL_JSON_METADATA,
    ) -> None:
        expected = dict(obj)
        if self.store.exists(uri=uri):
            existing = self._read_json(uri=uri)
            if existing != expected:
                raise SystemExit(f"Existing immutable run object conflicts: {uri}")
            return
        self._write_json(uri=uri, obj=expected, metadata=metadata)

    @staticmethod
    def _stored_public_manifest(
        manifest: CycleManifest,
        *,
        uri: str,
        dataset_id: str,
        label: str,
        cycle: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, object]:
        if manifest.dataset_id != dataset_id:
            raise SystemExit(
                f"{label} dataset_id mismatch: expected={dataset_id!r} found={manifest.dataset_id!r} uri={uri}"
            )
        if cycle is not None and manifest.cycle != cycle:
            raise SystemExit(f"{label} cycle mismatch: expected={cycle!r} found={manifest.cycle!r} uri={uri}")
        if run_id is not None and manifest.run_id != run_id:
            raise SystemExit(f"{label} run_id mismatch: expected={run_id!r} found={manifest.run_id!r} uri={uri}")
        return manifest.to_stored_dict()

    @staticmethod
    def _parse_public_manifest(
        raw: Mapping[str, Any],
        *,
        uri: str,
        dataset_id: str,
        label: str,
        cycle: str | None = None,
        run_id: str | None = None,
    ) -> CycleManifest:
        manifest = parse_cycle_manifest(raw, uri=uri)
        if manifest.dataset_id != dataset_id:
            raise SystemExit(
                f"{label} dataset_id mismatch: expected={dataset_id!r} found={manifest.dataset_id!r} uri={uri}"
            )
        if cycle is not None and manifest.cycle != cycle:
            raise SystemExit(f"{label} cycle mismatch: expected={cycle!r} found={manifest.cycle!r} uri={uri}")
        if run_id is not None and manifest.run_id != run_id:
            raise SystemExit(f"{label} run_id mismatch: expected={run_id!r} found={manifest.run_id!r} uri={uri}")
        return manifest

    def _write_bytes(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        self.store.write_bytes_with_metadata(uri=uri, data=data, metadata=metadata)
