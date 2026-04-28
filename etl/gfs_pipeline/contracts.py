"""Contracts and deterministic artifact naming.

This module defines:
- WorkItem: unit of execution identity (cycle + forecast hour + optional layer)
- ArtifactPaths: deterministic URI builder for artifacts (no I/O)

URIs are expected to use either:
- file:///abs/path[/prefix]
- s3://bucket/prefix
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from .layout import join_uri
from .scalar_encoding import scalar_payload_suffix_for_dtype


def _safe_segment(value: str) -> str:
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
    """Work identity.

    Notes:
    - `layer` is optional here so the contract can represent either
      per-(cycle,fhour) items or per-(cycle,fhour,layer) items.
    """

    cycle: str  # YYYYMMDDHH
    fhour: str  # FFF
    source_uri: str
    layer: Optional[str] = None

    def __post_init__(self) -> None:
        if len(self.cycle) != 10 or not self.cycle.isdigit():
            raise ValueError(f"cycle must be YYYYMMDDHH (10 digits), got: {self.cycle!r}")
        if len(self.fhour) != 3 or not self.fhour.isdigit():
            raise ValueError(f"fhour must be FFF (3 digits), got: {self.fhour!r}")
        if not str(self.source_uri).strip():
            raise ValueError("source_uri must be non-empty")
        if self.layer is not None:
            _ = _safe_segment(self.layer)  # validate layer segment


SUCCESS_MARKER_SUFFIX = "._SUCCESS.json"


@dataclass(frozen=True)
class ArtifactPaths:
    """Deterministic artifact URI builder."""

    artifact_root_uri: str

    def _cycle_fhour_layer_parts(self, item: WorkItem) -> tuple[str, str, str]:
        cycle = _safe_segment(item.cycle)
        fhour = _safe_segment(item.fhour)
        layer = _safe_segment(item.layer)
        return cycle, fhour, layer

    def success_marker_uri(self, item: WorkItem) -> str:
        """Success marker URI for given WorkItem: {root}/status/{cycle}/{layer}/{fhour}._SUCCESS.json"""
        cycle, fhour, layer = self._cycle_fhour_layer_parts(item)
        path = ["status", cycle, layer, f"{fhour}{SUCCESS_MARKER_SUFFIX}"]
        return join_uri(self.artifact_root_uri, path)

    def output_mbtiles_uri(self, item: WorkItem) -> str:
        """MBTiles URI for given WorkItem: {root}/tiles/{cycle}.{layer}.{fhour}.mbtiles"""
        cycle, fhour, layer = self._cycle_fhour_layer_parts(item)
        path = ["tiles", f"{cycle}.{layer}.{fhour}.mbtiles"]
        return join_uri(self.artifact_root_uri, path)

    def output_vector_payload_uri(self, item: WorkItem) -> str:
        """Vector payload URI: {root}/fields/{cycle}/{fhour}/{layer}.vector.i8.bin"""
        cycle, fhour, layer = self._cycle_fhour_layer_parts(item)
        path = ["fields", cycle, fhour, f"{layer}.vector.i8.bin"]
        return join_uri(self.artifact_root_uri, path)

    def output_scalar_payload_uri(self, item: WorkItem, *, dtype: str = "int16") -> str:
        """Scalar payload URI: {root}/fields/{cycle}/{fhour}/{layer}.scalar.<dtype>.bin"""
        cycle, fhour, layer = self._cycle_fhour_layer_parts(item)
        path = ["fields", cycle, fhour, f"{layer}.scalar.{scalar_payload_suffix_for_dtype(dtype)}.bin"]
        return join_uri(self.artifact_root_uri, path)

    def logs_uri(self, item: WorkItem) -> str:
        """Log file URI for given WorkItem: {root}/logs/{cycle}/{layer}/{fhour}.log"""
        cycle, fhour, layer = self._cycle_fhour_layer_parts(item)
        path = ["logs", cycle, layer, f"{fhour}.log"]
        return join_uri(self.artifact_root_uri, path)

    def success_marker_uri_parts(self, *, cycle: str, fhour: str, layer: str) -> str:
        """Success marker URI for given parts: {root}/status/{cycle}/{layer}/{fhour}._SUCCESS.json"""
        cycle = _safe_segment(cycle)
        fhour = _safe_segment(fhour)
        layer = _safe_segment(layer)
        path = ["status", cycle, layer, f"{fhour}{SUCCESS_MARKER_SUFFIX}"]
        return join_uri(self.artifact_root_uri, path)

    def status_prefix_uri(self, *, cycle: str) -> str:
        """Prefix under which status markers live: {root}/status/{cycle}/"""
        path = ["status", _safe_segment(cycle)]
        return join_uri(self.artifact_root_uri, path)

    def published_marker_uri(self, *, cycle: str) -> str:
        """Marker written by publish role when the cycle is published."""
        path = ["status", _safe_segment(cycle), "_PUBLISHED.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_cycle_uri(self, *, cycle: str) -> str:
        """Cycle manifest URI: {root}/manifests/{cycle}.json"""
        path = ["manifests", f"{_safe_segment(cycle)}.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_latest_uri(self) -> str:
        """Canonical latest manifest alias: {root}/manifests/latest.json"""
        path = ["manifests", "latest.json"]
        return join_uri(self.artifact_root_uri, path)
