"""Artifact repository boundary for forecast ETL storage."""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

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
            "cycle": item.cycle,
            "fhour": item.fhour,
            "artifact_id": item.artifact_id,
            "artifact": dict(artifact),
        })
        self._write_json(uri=uri, obj=marker, metadata=INTERNAL_JSON_METADATA, indent=None)
        return uri

    def read_artifact_success_marker(
        self,
        *,
        model_id: str,
        cycle: str,
        fhour: str,
        artifact_id: str,
    ) -> ArtifactSuccessMarker:
        """Read and validate one artifact success marker."""

        uri = self.paths.success_marker_uri_parts(
            model_id=model_id,
            cycle=cycle,
            fhour=fhour,
            artifact_id=artifact_id,
        )
        return self.read_artifact_success_marker_uri(uri)

    def read_artifact_success_marker_uri(self, uri: str) -> ArtifactSuccessMarker:
        """Read and validate one artifact success marker by URI."""

        return parse_artifact_success_marker(self.read_json_uri(uri), uri=uri)

    def read_json_uri(self, uri: str) -> dict[str, Any]:
        """Read a JSON artifact by exact URI."""

        return self._read_json(uri=uri)

    def list_success_marker_uris(self, *, model_id: str, cycle: str) -> set[str]:
        """List artifact success marker URIs for a model cycle."""

        prefix = self.paths.status_prefix_uri(model_id=model_id, cycle=cycle)
        return {uri for uri in self.store.list_prefix(prefix_uri=prefix) if uri.endswith(SUCCESS_MARKER_SUFFIX)}

    def list_status_objects(self, *, model_id: str, cycle: str) -> list[UriObject]:
        """List status artifact objects for a model cycle."""

        return self.store.list_objects(prefix_uri=self.paths.status_prefix_uri(model_id=model_id, cycle=cycle))

    def missing_success_markers(
        self,
        *,
        model_id: str,
        cycle: str,
        fhours: Iterable[str],
        artifact_ids: Iterable[str],
    ) -> list[str]:
        """Return expected artifact success markers missing from storage."""

        existing = self.list_success_marker_uris(model_id=model_id, cycle=cycle)
        expected = {
            self.paths.success_marker_uri_parts(model_id=model_id, cycle=cycle, fhour=fhour, artifact_id=artifact_id)
            for artifact_id in artifact_ids
            for fhour in fhours
        }
        return sorted(expected - existing)

    def write_cycle_manifest(self, *, model_id: str, cycle: str, manifest: Mapping[str, Any]) -> str:
        """Write one cycle manifest and return its artifact URI."""

        uri = self.paths.manifest_cycle_uri(model_id=model_id, cycle=cycle)
        self._write_json(uri=uri, obj=dict(manifest), metadata=FORECAST_JSON_METADATA)
        return uri

    def read_cycle_manifest(self, *, model_id: str, cycle: str) -> dict[str, Any]:
        """Read one cycle manifest."""

        return self._read_json(uri=self.paths.manifest_cycle_uri(model_id=model_id, cycle=cycle))

    def cycle_manifest_exists(self, *, model_id: str, cycle: str) -> bool:
        """Return whether the cycle manifest exists."""

        return self.store.exists(uri=self.paths.manifest_cycle_uri(model_id=model_id, cycle=cycle))

    def write_latest_manifest(self, *, model_id: str, manifest: Mapping[str, Any]) -> str:
        """Write the latest manifest alias and return its artifact URI."""

        uri = self.paths.manifest_latest_uri(model_id=model_id)
        self._write_json(uri=uri, obj=dict(manifest), metadata=LATEST_MANIFEST_METADATA)
        return uri

    def read_latest_manifest(self, *, model_id: str) -> dict[str, Any]:
        """Read the latest manifest alias."""

        return self._read_json(uri=self.paths.manifest_latest_uri(model_id=model_id))

    def latest_manifest_exists(self, *, model_id: str) -> bool:
        """Return whether the latest manifest alias exists."""

        return self.store.exists(uri=self.paths.manifest_latest_uri(model_id=model_id))

    def write_forecast_manifest(self, *, manifest: Mapping[str, Any]) -> str:
        """Write the frontend forecast manifest and return its artifact URI."""

        uri = self.paths.forecast_manifest_uri()
        self._write_json(uri=uri, obj=dict(manifest), metadata=LATEST_MANIFEST_METADATA)
        return uri

    def read_forecast_manifest(self) -> dict[str, Any]:
        """Read the frontend forecast manifest."""

        return self._read_json(uri=self.paths.forecast_manifest_uri())

    def forecast_manifest_exists(self) -> bool:
        """Return whether the frontend forecast manifest exists."""

        return self.store.exists(uri=self.paths.forecast_manifest_uri())

    def list_manifest_objects(self, *, model_id: str) -> list[UriObject]:
        """List manifest objects for a model."""

        return self.store.list_objects(prefix_uri=self.paths.manifest_prefix_uri(model_id=model_id))

    def write_published_marker(self, *, model_id: str, cycle: str, marker: Mapping[str, Any]) -> str:
        """Write the published marker and return its artifact URI."""

        uri = self.paths.published_marker_uri(model_id=model_id, cycle=cycle)
        self._write_json(uri=uri, obj=dict(marker), metadata=INTERNAL_JSON_METADATA)
        return uri

    def read_published_marker(self, *, model_id: str, cycle: str) -> PublishedMarker:
        """Read and validate the published marker for a cycle."""

        uri = self.paths.published_marker_uri(model_id=model_id, cycle=cycle)
        return parse_published_marker(self._read_json(uri=uri), uri=uri)

    def published_marker_exists(self, *, model_id: str, cycle: str) -> bool:
        """Return whether the published marker exists."""

        return self.store.exists(uri=self.paths.published_marker_uri(model_id=model_id, cycle=cycle))

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

    def _write_bytes(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        if isinstance(self.store, MetadataUriStore):
            self.store.write_bytes_with_metadata(uri=uri, data=data, metadata=metadata)
            return
        self.store.write_bytes(uri=uri, data=data)
