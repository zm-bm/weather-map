"""Artifact identity and deterministic artifact naming.

This module defines:
- WorkItem: unit of execution identity (model + cycle + forecast hour + optional product_id)
- ArtifactPaths: deterministic URI builder for artifacts (no I/O)

URIs are expected to use either:
- file:///abs/path[/prefix]
- s3://bucket/prefix
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..encoding.codecs import payload_suffix_for_dtype
from ..sources.gfs_layout import join_uri


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
    - `product_id` is optional here so the contract can represent either
      per-(cycle,fhour) items or per-(cycle,fhour,product_id) items.
    """

    cycle: str  # YYYYMMDDHH
    fhour: str  # FFF
    source_uri: str
    model_id: str
    product_id: Optional[str] = None

    def __post_init__(self) -> None:
        _ = _safe_segment(self.model_id)
        if len(self.cycle) != 10 or not self.cycle.isdigit():
            raise ValueError(f"cycle must be YYYYMMDDHH (10 digits), got: {self.cycle!r}")
        if len(self.fhour) != 3 or not self.fhour.isdigit():
            raise ValueError(f"fhour must be FFF (3 digits), got: {self.fhour!r}")
        if not str(self.source_uri).strip():
            raise ValueError("source_uri must be non-empty")
        if self.product_id is not None:
            _ = _safe_segment(self.product_id)  # validate product segment


SUCCESS_MARKER_SUFFIX = "._SUCCESS.json"


@dataclass(frozen=True)
class ArtifactPaths:
    """Deterministic artifact URI builder."""

    artifact_root_uri: str

    def _model_cycle_fhour_product_parts(self, item: WorkItem) -> tuple[str, str, str, str]:
        model_id = _safe_segment(item.model_id)
        cycle = _safe_segment(item.cycle)
        fhour = _safe_segment(item.fhour)
        if item.product_id is None:
            raise ValueError("product_id is required for product artifact paths")
        product_id = _safe_segment(item.product_id)
        return model_id, cycle, fhour, product_id

    def success_marker_uri(self, item: WorkItem) -> str:
        """Success marker URI: {root}/status/{model}/{cycle}/{product}/{fhour}._SUCCESS.json"""
        model_id, cycle, fhour, product_id = self._model_cycle_fhour_product_parts(item)
        path = ["status", model_id, cycle, product_id, f"{fhour}{SUCCESS_MARKER_SUFFIX}"]
        return join_uri(self.artifact_root_uri, path)

    def output_vector_payload_uri(self, item: WorkItem) -> str:
        """Vector payload URI: {root}/fields/{model}/{cycle}/{fhour}/{product}.vector.i8.bin"""
        model_id, cycle, fhour, product_id = self._model_cycle_fhour_product_parts(item)
        path = ["fields", model_id, cycle, fhour, f"{product_id}.vector.i8.bin"]
        return join_uri(self.artifact_root_uri, path)

    def output_scalar_payload_uri(self, item: WorkItem, *, dtype: str = "int16") -> str:
        """Scalar payload URI: {root}/fields/{model}/{cycle}/{fhour}/{product}.scalar.<dtype>.bin"""
        model_id, cycle, fhour, product_id = self._model_cycle_fhour_product_parts(item)
        path = [
            "fields",
            model_id,
            cycle,
            fhour,
            f"{product_id}.scalar.{payload_suffix_for_dtype(dtype)}.bin",
        ]
        return join_uri(self.artifact_root_uri, path)

    def logs_uri(self, item: WorkItem) -> str:
        """Log file URI for given WorkItem: {root}/logs/{model}/{cycle}/{product}/{fhour}.log"""
        model_id, cycle, fhour, product_id = self._model_cycle_fhour_product_parts(item)
        path = ["logs", model_id, cycle, product_id, f"{fhour}.log"]
        return join_uri(self.artifact_root_uri, path)

    def success_marker_uri_parts(self, *, model_id: str, cycle: str, fhour: str, product_id: str) -> str:
        """Success marker URI for given parts: {root}/status/{model}/{cycle}/{product}/{fhour}._SUCCESS.json"""
        model_id = _safe_segment(model_id)
        cycle = _safe_segment(cycle)
        fhour = _safe_segment(fhour)
        product_id = _safe_segment(product_id)
        path = ["status", model_id, cycle, product_id, f"{fhour}{SUCCESS_MARKER_SUFFIX}"]
        return join_uri(self.artifact_root_uri, path)

    def status_prefix_uri(self, *, model_id: str, cycle: str) -> str:
        """Prefix under which status markers live: {root}/status/{model}/{cycle}/"""
        path = ["status", _safe_segment(model_id), _safe_segment(cycle)]
        return join_uri(self.artifact_root_uri, path)

    def published_marker_uri(self, *, model_id: str, cycle: str) -> str:
        """Marker written by publish role when the cycle is published."""
        path = ["status", _safe_segment(model_id), _safe_segment(cycle), "_PUBLISHED.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_cycle_uri(self, *, model_id: str, cycle: str) -> str:
        """Cycle manifest URI: {root}/manifests/{model}/{cycle}.json"""
        path = ["manifests", _safe_segment(model_id), f"{_safe_segment(cycle)}.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_latest_uri(self, *, model_id: str) -> str:
        """Canonical latest manifest alias: {root}/manifests/{model}/latest.json"""
        path = ["manifests", _safe_segment(model_id), "latest.json"]
        return join_uri(self.artifact_root_uri, path)
