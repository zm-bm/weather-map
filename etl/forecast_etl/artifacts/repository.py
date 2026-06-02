"""Artifact repository boundary for forecast ETL storage."""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from ..run_ids import validate_run_id
from ..run_metadata import RunSnapshot
from ..storage.base import MetadataUriStore, UriObject, UriStore, UriWriteMetadata
from .markers_schema import ArtifactSuccessMarker, artifact_success_marker_dict, parse_artifact_success_marker
from .paths import SUCCESS_MARKER_SUFFIX, ArtifactPaths, WorkItem
from .published_schema import PublishedMarker, parse_published_marker

LATEST_MANIFEST_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=60"
FORECAST_ARTIFACT_CACHE_CONTROL = "public, max-age=3600, s-maxage=21600, stale-while-revalidate=300"
INTERNAL_ARTIFACT_CACHE_CONTROL = "private, no-store"

FIELD_PAYLOAD_METADATA = UriWriteMetadata(
    content_type="application/octet-stream",
    cache_control=FORECAST_ARTIFACT_CACHE_CONTROL,
    content_encoding="gzip",
)
FORECAST_JSON_METADATA = UriWriteMetadata(
    content_type="application/json",
    cache_control=FORECAST_ARTIFACT_CACHE_CONTROL,
)
LATEST_MANIFEST_METADATA = UriWriteMetadata(
    content_type="application/json",
    cache_control=LATEST_MANIFEST_CACHE_CONTROL,
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

    def write_field_payload(self, *, item: WorkItem, dtype: str, payload: bytes) -> str:
        """Write one encoded field payload and return its artifact URI."""

        uri = self.paths.output_field_payload_uri(item, dtype=dtype)
        self._write_bytes(uri=uri, data=gzip.compress(payload, mtime=0), metadata=FIELD_PAYLOAD_METADATA)
        return uri

    def write_success_marker(self, *, item: WorkItem, artifact: Mapping[str, Any]) -> str:
        """Write one artifact success marker and return its artifact URI."""

        uri = self.paths.success_marker_uri(item)
        marker = artifact_success_marker_dict({
            "dataset_id": item.dataset_id,
            "cycle": item.cycle,
            "run_id": item.run_id,
            "frame_id": item.frame_id,
            "artifact_id": item.artifact_id,
            "code_revision": item.code_revision,
            "image_identity": item.image_identity,
            "config_digest": item.config_digest,
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
        pipeline_config_uri = self.paths.run_pipeline_config_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        forecast_catalog_uri = self.paths.run_forecast_catalog_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        run_doc = {
            "schema": "weather-map.etl-run",
            "schema_version": 1,
            "dataset_id": dataset_id,
            "cycle": cycle,
            "run_id": validate_run_id(run_id),
            "code_revision": snapshot.metadata.code_revision,
            "image_identity": snapshot.metadata.image_identity,
            "config_digest": snapshot.metadata.config_digest,
            "pipeline_config_path": self.paths.relative_key(pipeline_config_uri),
            "forecast_catalog_path": self.paths.relative_key(forecast_catalog_uri),
        }

        self._write_json_once_or_same(uri=pipeline_config_uri, obj=snapshot.pipeline_config)
        self._write_json_once_or_same(uri=forecast_catalog_uri, obj=snapshot.forecast_catalog)
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

        prefix = self.paths.model_runs_prefix_uri(dataset_id=dataset_id)
        cycles: set[str] = set()
        for uri in self.store.list_prefix(prefix_uri=prefix):
            try:
                key = self.paths.relative_key(uri)
            except ValueError:
                continue
            parts = key.split("/")
            if len(parts) >= 3 and parts[:2] == ["runs", dataset_id]:
                cycle = parts[2]
                if len(cycle) == 10 and cycle.isdigit():
                    cycles.add(cycle)
        return tuple(sorted(cycles))

    def list_run_objects(self, *, dataset_id: str, cycle: str, run_id: str) -> list[UriObject]:
        """List all objects for one run prefix."""

        return self.store.list_objects(prefix_uri=self.paths.run_prefix_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def delete_run_objects(self, *, dataset_id: str, cycle: str, run_id: str) -> list[UriObject]:
        """Delete all objects for one run prefix and return the listed objects."""

        objects = self.list_run_objects(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        for obj in objects:
            self.store.delete_uri(uri=obj.uri)
        return objects

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

    def write_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str, manifest: Mapping[str, Any]) -> str:
        """Write one immutable run manifest and return its artifact URI."""

        uri = self.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        self._write_json(uri=uri, obj=dict(manifest), metadata=FORECAST_JSON_METADATA)
        return uri

    def read_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
        """Read one immutable run manifest."""

        return self._read_json(uri=self.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def run_manifest_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether the immutable run manifest exists."""

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

    def write_public_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str, manifest: Mapping[str, Any]) -> str:
        """Write or verify the immutable public run manifest."""

        uri = self.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        self._write_json_once_or_same(uri=uri, obj=dict(manifest), metadata=FORECAST_JSON_METADATA)
        return uri

    def read_public_run_manifest(self, *, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
        """Read one immutable public run manifest."""

        return self._read_json(uri=self.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def public_run_manifest_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether one immutable public run manifest exists."""

        return self.store.exists(uri=self.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

    def write_cycle_current_pointer(self, *, dataset_id: str, cycle: str, pointer: Mapping[str, Any]) -> str:
        """Write the public current pointer for one dataset cycle."""

        uri = self.paths.cycle_current_pointer_uri(dataset_id=dataset_id, cycle=cycle)
        self._write_json(uri=uri, obj=dict(pointer), metadata=LATEST_MANIFEST_METADATA)
        return uri

    def read_cycle_current_pointer(self, *, dataset_id: str, cycle: str) -> dict[str, Any]:
        """Read the public current pointer for one dataset cycle."""

        return self._read_json(uri=self.paths.cycle_current_pointer_uri(dataset_id=dataset_id, cycle=cycle))

    def cycle_current_pointer_exists(self, *, dataset_id: str, cycle: str) -> bool:
        """Return whether the public current pointer for one dataset cycle exists."""

        return self.store.exists(uri=self.paths.cycle_current_pointer_uri(dataset_id=dataset_id, cycle=cycle))

    def write_latest_pointer(self, *, dataset_id: str, pointer: Mapping[str, Any]) -> str:
        """Write the latest manifest pointer alias and return its artifact URI."""

        uri = self.paths.manifest_latest_uri(dataset_id=dataset_id)
        self._write_json(uri=uri, obj=dict(pointer), metadata=LATEST_MANIFEST_METADATA)
        return uri

    def read_latest_pointer(self, *, dataset_id: str) -> dict[str, Any]:
        """Read the latest manifest pointer alias."""

        return self._read_json(uri=self.paths.manifest_latest_uri(dataset_id=dataset_id))

    def latest_manifest_exists(self, *, dataset_id: str) -> bool:
        """Return whether the latest manifest alias exists."""

        return self.store.exists(uri=self.paths.manifest_latest_uri(dataset_id=dataset_id))

    def write_data_manifest(self, *, manifest: Mapping[str, Any]) -> str:
        """Write the frontend data manifest and return its artifact URI."""

        uri = self.paths.data_manifest_uri()
        self._write_json(uri=uri, obj=dict(manifest), metadata=LATEST_MANIFEST_METADATA)
        return uri

    def read_data_manifest(self) -> dict[str, Any]:
        """Read the frontend data manifest."""

        return self._read_json(uri=self.paths.data_manifest_uri())

    def data_manifest_exists(self) -> bool:
        """Return whether the frontend data manifest exists."""

        return self.store.exists(uri=self.paths.data_manifest_uri())

    def list_manifest_objects(self, *, dataset_id: str) -> list[UriObject]:
        """List manifest objects for a dataset."""

        return self.store.list_objects(prefix_uri=self.paths.manifest_prefix_uri(dataset_id=dataset_id))

    def write_published_marker(self, *, dataset_id: str, cycle: str, run_id: str, marker: Mapping[str, Any]) -> str:
        """Write the published marker and return its artifact URI."""

        uri = self.paths.published_marker_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        self._write_json(uri=uri, obj=dict(marker), metadata=INTERNAL_JSON_METADATA)
        return uri

    def read_published_marker(self, *, dataset_id: str, cycle: str, run_id: str) -> PublishedMarker:
        """Read and validate the published marker for a run."""

        uri = self.paths.published_marker_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return parse_published_marker(self._read_json(uri=uri), uri=uri)

    def published_marker_exists(self, *, dataset_id: str, cycle: str, run_id: str) -> bool:
        """Return whether the published marker exists."""

        return self.store.exists(uri=self.paths.published_marker_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id))

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

    def _write_bytes(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        if isinstance(self.store, MetadataUriStore):
            self.store.write_bytes_with_metadata(uri=uri, data=data, metadata=metadata)
            return
        self.store.write_bytes(uri=uri, data=data)
