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
from ..run_ids import validate_run_id
from ..run_metadata import metadata_value
from ..uris import join_uri

SUCCESS_MARKER_SUFFIX = "._SUCCESS.json"
PUBLISHED_MARKER_FILENAME = "_PUBLISHED.json"
FORECAST_MANIFEST_FILENAME = "forecast-manifest.json"


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
    run_id: str
    fhour: str  # FFF
    source_uri: str
    model_id: str
    artifact_id: Optional[str] = None
    code_revision: str = "unknown"
    image_identity: str = "unknown"
    config_digest: str = "unknown"

    def __post_init__(self) -> None:
        _ = _safe_segment(self.model_id)
        if len(self.cycle) != 10 or not self.cycle.isdigit():
            raise ValueError(f"cycle must be YYYYMMDDHH (10 digits), got: {self.cycle!r}")
        validate_run_id(self.run_id)
        if len(self.fhour) != 3 or not self.fhour.isdigit():
            raise ValueError(f"fhour must be FFF (3 digits), got: {self.fhour!r}")
        if not str(self.source_uri).strip():
            raise ValueError("source_uri must be non-empty")
        if self.artifact_id is not None:
            _ = _safe_segment(self.artifact_id)  # validate artifact segment
        object.__setattr__(self, "code_revision", metadata_value(self.code_revision))
        object.__setattr__(self, "image_identity", metadata_value(self.image_identity))
        object.__setattr__(self, "config_digest", metadata_value(self.config_digest))


@dataclass(frozen=True)
class ArtifactPaths:
    """Deterministic URI builder for ETL fields, markers, logs, and manifests."""

    artifact_root_uri: str

    def _model_cycle_fhour_artifact_parts(self, item: WorkItem) -> tuple[str, str, str, str]:
        model_id = _safe_segment(item.model_id)
        cycle = _safe_segment(item.cycle)
        validate_run_id(item.run_id)
        fhour = _safe_segment(item.fhour)
        if item.artifact_id is None:
            raise ValueError("artifact_id is required for artifact paths")
        artifact_id = _safe_segment(item.artifact_id)
        return model_id, cycle, fhour, artifact_id

    def run_prefix_key(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Relative key prefix for one immutable ETL run."""

        return "/".join([
            "runs",
            _safe_segment(model_id),
            _safe_segment(cycle),
            validate_run_id(run_id),
        ])

    def run_prefix_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """URI prefix for one immutable ETL run."""

        return join_uri(self.artifact_root_uri, [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id)])

    def cycle_runs_prefix_uri(self, *, model_id: str, cycle: str) -> str:
        """URI prefix under which all runs for one model cycle live."""

        return join_uri(self.artifact_root_uri, ["runs", _safe_segment(model_id), _safe_segment(cycle)])

    def run_metadata_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Run metadata URI: {root}/runs/{model}/{cycle}/{run_id}/run.json"""

        return join_uri(self.artifact_root_uri, [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), "run.json"])

    def run_pipeline_config_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Pipeline config snapshot URI for one run."""

        return join_uri(
            self.artifact_root_uri,
            [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), "config", "pipeline_config.json"],
        )

    def run_forecast_catalog_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Forecast catalog snapshot URI for one run."""

        return join_uri(
            self.artifact_root_uri,
            [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), "config", "forecast_catalog.json"],
        )

    def success_marker_uri(self, item: WorkItem) -> str:
        """Success marker URI: {root}/runs/{model}/{cycle}/{run_id}/status/{artifact}/{fhour}._SUCCESS.json"""
        model_id, cycle, fhour, artifact_id = self._model_cycle_fhour_artifact_parts(item)
        path = [
            self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=item.run_id),
            "status",
            artifact_id,
            f"{fhour}{SUCCESS_MARKER_SUFFIX}",
        ]
        return join_uri(self.artifact_root_uri, path)

    def output_field_payload_uri(self, item: WorkItem, *, dtype: str) -> str:
        """Field payload URI: {root}/runs/{model}/{cycle}/{run_id}/fields/{fhour}/{artifact}.field.<dtype>.bin"""
        model_id, cycle, fhour, artifact_id = self._model_cycle_fhour_artifact_parts(item)
        path = [
            self.field_payload_root_key(model_id=model_id, cycle=cycle, run_id=item.run_id),
            fhour,
            self.field_payload_filename(artifact_id=artifact_id, dtype=dtype),
        ]
        return join_uri(self.artifact_root_uri, path)

    def field_payload_root_key(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Relative public field payload root key for one run."""

        return "/".join([self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), "fields"])

    def field_payload_filename(self, *, artifact_id: str, dtype: str) -> str:
        """Field payload filename for one artifact and dtype."""

        artifact_id = _safe_segment(artifact_id)
        return f"{artifact_id}.field.{payload_suffix_for_dtype(dtype)}.bin"

    def logs_uri(self, item: WorkItem) -> str:
        """Log file URI for given WorkItem: {root}/runs/{model}/{cycle}/{run_id}/logs/{artifact}/{fhour}.log"""
        model_id, cycle, fhour, artifact_id = self._model_cycle_fhour_artifact_parts(item)
        path = [
            self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=item.run_id),
            "logs",
            artifact_id,
            f"{fhour}.log",
        ]
        return join_uri(self.artifact_root_uri, path)

    def success_marker_uri_parts(
        self,
        *,
        model_id: str,
        cycle: str,
        run_id: str,
        fhour: str,
        artifact_id: str,
    ) -> str:
        """Success marker URI for given parts under a run prefix."""
        model_id = _safe_segment(model_id)
        cycle = _safe_segment(cycle)
        run_id = validate_run_id(run_id)
        fhour = _safe_segment(fhour)
        artifact_id = _safe_segment(artifact_id)
        path = [
            self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id),
            "status",
            artifact_id,
            f"{fhour}{SUCCESS_MARKER_SUFFIX}",
        ]
        return join_uri(self.artifact_root_uri, path)

    def status_prefix_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Prefix under which one run's status markers live."""
        path = [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), "status"]
        return join_uri(self.artifact_root_uri, path)

    def published_marker_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Marker written by publish role when the run is published."""
        path = [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), PUBLISHED_MARKER_FILENAME]
        return join_uri(self.artifact_root_uri, path)

    def run_manifest_uri(self, *, model_id: str, cycle: str, run_id: str) -> str:
        """Canonical internal manifest URI for one immutable run."""

        path = [self.run_prefix_key(model_id=model_id, cycle=cycle, run_id=run_id), "manifest.json"]
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

    def forecast_manifest_uri(self) -> str:
        """Frontend forecast manifest URI: {root}/manifests/forecast-manifest.json"""
        path = ["manifests", FORECAST_MANIFEST_FILENAME]
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
