"""Artifact identity and deterministic artifact naming.

This module defines:
- WorkItem: unit of execution identity (model + cycle + forecast hour + optional artifact_id)
- ArtifactPaths: deterministic URI builder for artifacts (no I/O)

URIs are expected to use either:
- file:///abs/path[/prefix]
- s3://bucket/prefix
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..encoding.codecs import payload_suffix_for_dtype
from ..uris import join_uri

SUCCESS_MARKER_SUFFIX = "._SUCCESS.json"
PUBLISHED_MARKER_FILENAME = "_PUBLISHED.json"
AVAILABILITY_INDEX_FILENAME = "availability-index.json"


def _safe_segment(value: str) -> str:
    """Validate one URI path segment used in deterministic artifact paths."""

    v = value.strip()
    if not v:
        raise ValueError("Empty path segment")
    if v in {".", ".."}:
        raise ValueError(f"Invalid path segment: {v!r}")
    if "/" in v or "\\" in v:
        raise ValueError(f"Invalid path segment (contains path separator): {v!r}")
    return v


@dataclass(frozen=True)
class WorkItem:
    """Execution identity for one cycle, forecast hour, and optional artifact."""

    cycle: str  # YYYYMMDDHH
    fhour: str  # FFF
    source_uri: str
    model_id: str
    artifact_id: Optional[str] = None

    def __post_init__(self) -> None:
        _ = _safe_segment(self.model_id)
        if len(self.cycle) != 10 or not self.cycle.isdigit():
            raise ValueError(f"cycle must be YYYYMMDDHH (10 digits), got: {self.cycle!r}")
        if len(self.fhour) != 3 or not self.fhour.isdigit():
            raise ValueError(f"fhour must be FFF (3 digits), got: {self.fhour!r}")
        if not str(self.source_uri).strip():
            raise ValueError("source_uri must be non-empty")
        if self.artifact_id is not None:
            _ = _safe_segment(self.artifact_id)  # validate artifact segment


@dataclass(frozen=True)
class ArtifactPaths:
    """Deterministic URI builder for ETL fields, markers, logs, and manifests."""

    artifact_root_uri: str

    def _model_cycle_fhour_artifact_parts(self, item: WorkItem) -> tuple[str, str, str, str]:
        model_id = _safe_segment(item.model_id)
        cycle = _safe_segment(item.cycle)
        fhour = _safe_segment(item.fhour)
        if item.artifact_id is None:
            raise ValueError("artifact_id is required for artifact paths")
        artifact_id = _safe_segment(item.artifact_id)
        return model_id, cycle, fhour, artifact_id

    def success_marker_uri(self, item: WorkItem) -> str:
        """Success marker URI: {root}/status/{model}/{cycle}/{artifact}/{fhour}._SUCCESS.json"""
        model_id, cycle, fhour, artifact_id = self._model_cycle_fhour_artifact_parts(item)
        path = ["status", model_id, cycle, artifact_id, f"{fhour}{SUCCESS_MARKER_SUFFIX}"]
        return join_uri(self.artifact_root_uri, path)

    def output_field_payload_uri(self, item: WorkItem, *, dtype: str) -> str:
        """Field payload URI: {root}/fields/{model}/{cycle}/{fhour}/{artifact}.field.<dtype>.bin"""
        model_id, cycle, fhour, artifact_id = self._model_cycle_fhour_artifact_parts(item)
        path = [
            "fields",
            model_id,
            cycle,
            fhour,
            f"{artifact_id}.field.{payload_suffix_for_dtype(dtype)}.bin",
        ]
        return join_uri(self.artifact_root_uri, path)

    def logs_uri(self, item: WorkItem) -> str:
        """Log file URI for given WorkItem: {root}/logs/{model}/{cycle}/{artifact}/{fhour}.log"""
        model_id, cycle, fhour, artifact_id = self._model_cycle_fhour_artifact_parts(item)
        path = ["logs", model_id, cycle, artifact_id, f"{fhour}.log"]
        return join_uri(self.artifact_root_uri, path)

    def success_marker_uri_parts(self, *, model_id: str, cycle: str, fhour: str, artifact_id: str) -> str:
        """Success marker URI for given parts: {root}/status/{model}/{cycle}/{artifact}/{fhour}._SUCCESS.json"""
        model_id = _safe_segment(model_id)
        cycle = _safe_segment(cycle)
        fhour = _safe_segment(fhour)
        artifact_id = _safe_segment(artifact_id)
        path = ["status", model_id, cycle, artifact_id, f"{fhour}{SUCCESS_MARKER_SUFFIX}"]
        return join_uri(self.artifact_root_uri, path)

    def status_prefix_uri(self, *, model_id: str, cycle: str) -> str:
        """Prefix under which status markers live: {root}/status/{model}/{cycle}/"""
        path = ["status", _safe_segment(model_id), _safe_segment(cycle)]
        return join_uri(self.artifact_root_uri, path)

    def published_marker_uri(self, *, model_id: str, cycle: str) -> str:
        """Marker written by publish role when the cycle is published."""
        path = ["status", _safe_segment(model_id), _safe_segment(cycle), PUBLISHED_MARKER_FILENAME]
        return join_uri(self.artifact_root_uri, path)

    def manifest_cycle_uri(self, *, model_id: str, cycle: str) -> str:
        """Cycle manifest URI: {root}/manifests/{model}/{cycle}.json"""
        path = ["manifests", _safe_segment(model_id), f"{_safe_segment(cycle)}.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_prefix_uri(self, *, model_id: str) -> str:
        """Prefix under which cycle manifests live: {root}/manifests/{model}/"""
        path = ["manifests", _safe_segment(model_id)]
        return join_uri(self.artifact_root_uri, path)

    def manifest_latest_uri(self, *, model_id: str) -> str:
        """Canonical latest manifest alias: {root}/manifests/{model}/latest.json"""
        path = ["manifests", _safe_segment(model_id), "latest.json"]
        return join_uri(self.artifact_root_uri, path)

    def availability_index_uri(self) -> str:
        """Model/layer availability index URI: {root}/manifests/availability-index.json"""
        path = ["manifests", AVAILABILITY_INDEX_FILENAME]
        return join_uri(self.artifact_root_uri, path)

    def relative_key(self, uri: str) -> str:
        """Return an artifact URI relative to the artifact root."""

        root = self.artifact_root_uri.rstrip("/")
        if uri == root:
            return ""
        prefix = f"{root}/"
        if not uri.startswith(prefix):
            raise ValueError(f"Artifact URI is not under root: uri={uri!r} root={self.artifact_root_uri!r}")
        return uri[len(prefix) :]
