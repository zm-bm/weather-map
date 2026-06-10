"""Deterministic artifact URI naming.

This module defines ArtifactPaths, the no-I/O URI builder for persisted ETL
outputs.

URIs are expected to use either:
- file:///abs/path[/prefix]
- s3://bucket/prefix
"""

from __future__ import annotations

from dataclasses import dataclass

from ...config.encoding import payload_suffix_for_dtype
from ...core.cycles import validate_cycle_id
from ...core.frames import validate_frame_id
from ...storage.uris import ARTIFACT_ROOT_SCHEMES, join_uri, normalize_resource_uri
from ..runs.ids import validate_run_id
from .identity import ArtifactWorkItem, safe_segment

SUCCESS_MARKER_SUFFIX = "._SUCCESS.json"
PUBLICATION_FILENAME = "publication.json"
MANIFEST_INDEX_FILENAME = "index.json"
STATUS_DOCUMENT_FILENAME = "status.json"
VALIDATION_REPORT_FILENAME = "validation.json"


@dataclass(frozen=True)
class ArtifactPaths:
    """Deterministic URI builder for ETL payloads, markers, and manifests."""

    artifact_root_uri: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "artifact_root_uri",
            normalize_resource_uri(self.artifact_root_uri, allowed_schemes=ARTIFACT_ROOT_SCHEMES),
        )

    def _run_key(self, *, dataset_id: str, cycle: str, run_id: str, parts: tuple[str, ...] = ()) -> str:
        return "/".join([
            "runs",
            safe_segment(dataset_id),
            validate_cycle_id(cycle),
            validate_run_id(run_id),
            *parts,
        ])

    def _run_uri(self, *, dataset_id: str, cycle: str, run_id: str, parts: tuple[str, ...] = ()) -> str:
        return join_uri(self.artifact_root_uri, [self._run_key(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=parts)])

    def cycle_runs_prefix_uri(self, *, dataset_id: str, cycle: str) -> str:
        """URI prefix under which all runs for one dataset cycle live."""

        return join_uri(self.artifact_root_uri, ["runs", safe_segment(dataset_id), validate_cycle_id(cycle)])

    def dataset_runs_prefix_uri(self, *, dataset_id: str) -> str:
        """URI prefix under which all cycles for one dataset live."""

        return join_uri(self.artifact_root_uri, ["runs", safe_segment(dataset_id)])

    def run_metadata_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Run metadata URI: {root}/runs/{dataset_id}/{cycle}/{run_id}/run.json"""

        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=("run.json",))

    def run_pipeline_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Pipeline config snapshot URI for one run."""

        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=("config", "pipeline.json"))

    def run_catalog_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Catalog snapshot URI for one run."""

        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=("config", "catalog.json"))

    def success_marker_uri(self, item: ArtifactWorkItem) -> str:
        """Success marker URI: {root}/runs/{dataset_id}/{cycle}/{run_id}/status/{artifact}/{frame_id}._SUCCESS.json"""
        return self.success_marker_uri_parts(
            dataset_id=item.dataset_id,
            cycle=item.cycle,
            run_id=item.run_id,
            frame_id=item.frame_id,
            artifact_id=item.artifact_id,
        )

    def payload_uri(self, item: ArtifactWorkItem, *, dtype: str) -> str:
        """Payload URI: {root}/runs/{dataset_id}/{cycle}/{run_id}/payloads/{frame_id}/{artifact}.<dtype>.bin"""
        return self.payload_uri_parts(
            dataset_id=item.dataset_id,
            cycle=item.cycle,
            run_id=item.run_id,
            frame_id=item.frame_id,
            artifact_id=item.artifact_id,
            dtype=dtype,
        )

    def payload_root_key(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Relative public payload root key for one run."""

        return self._run_key(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=("payloads",))

    def payload_filename(self, *, artifact_id: str, dtype: str) -> str:
        """Payload filename for one artifact and dtype."""

        artifact_id = safe_segment(artifact_id)
        return f"{artifact_id}.{payload_suffix_for_dtype(dtype)}.bin"

    def payload_uri_parts(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_id: str,
        dtype: str,
    ) -> str:
        """Payload URI for given parts under a run prefix."""
        dataset_id = safe_segment(dataset_id)
        cycle = validate_cycle_id(cycle)
        run_id = validate_run_id(run_id)
        frame_id = validate_frame_id(frame_id)
        artifact_id = safe_segment(artifact_id)
        return self._run_uri(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            parts=("payloads", frame_id, self.payload_filename(artifact_id=artifact_id, dtype=dtype)),
        )

    def success_marker_uri_parts(
        self,
        *,
        dataset_id: str,
        cycle: str,
        run_id: str,
        frame_id: str,
        artifact_id: str,
    ) -> str:
        """Success marker URI for given parts under a run prefix."""
        dataset_id = safe_segment(dataset_id)
        cycle = validate_cycle_id(cycle)
        run_id = validate_run_id(run_id)
        frame_id = validate_frame_id(frame_id)
        artifact_id = safe_segment(artifact_id)
        return self._run_uri(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            parts=("status", artifact_id, f"{frame_id}{SUCCESS_MARKER_SUFFIX}"),
        )

    def status_prefix_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Prefix under which one run's status markers live."""
        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=("status",))

    def publication_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Marker written by publish role when the run is published."""
        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=(PUBLICATION_FILENAME,))

    def run_manifest_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Canonical internal manifest URI for one immutable run."""

        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=("manifest.json",))

    def validation_report_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Run validation report URI: {root}/runs/{dataset_id}/{cycle}/{run_id}/validation.json"""

        return self._run_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id, parts=(VALIDATION_REPORT_FILENAME,))

    def public_run_manifest_key(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Relative key for an immutable public run manifest."""

        return "/".join(
            [
                "manifests",
                safe_segment(dataset_id),
                "cycles",
                validate_cycle_id(cycle),
                "runs",
                f"{validate_run_id(run_id)}.json",
            ]
        )

    def public_run_manifest_uri(self, *, dataset_id: str, cycle: str, run_id: str) -> str:
        """Public full manifest URI for one immutable run."""

        return join_uri(
            self.artifact_root_uri,
            [self.public_run_manifest_key(dataset_id=dataset_id, cycle=cycle, run_id=run_id)],
        )

    def cycle_current_manifest_uri(self, *, dataset_id: str, cycle: str) -> str:
        """Current manifest URI: {root}/manifests/{dataset_id}/cycles/{cycle}/current.json"""

        path = ["manifests", safe_segment(dataset_id), "cycles", validate_cycle_id(cycle), "current.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_prefix_uri(self, *, dataset_id: str) -> str:
        """Prefix under which public dataset manifests live."""
        path = ["manifests", safe_segment(dataset_id)]
        return join_uri(self.artifact_root_uri, path)

    def latest_manifest_uri(self, *, dataset_id: str) -> str:
        """Latest manifest URI: {root}/manifests/{dataset_id}/latest.json"""
        path = ["manifests", safe_segment(dataset_id), "latest.json"]
        return join_uri(self.artifact_root_uri, path)

    def manifest_index_uri(self) -> str:
        """Frontend manifest index URI: {root}/manifests/index.json"""
        path = ["manifests", MANIFEST_INDEX_FILENAME]
        return join_uri(self.artifact_root_uri, path)

    def status_uri(self) -> str:
        """Public ETL status URI: {root}/status.json"""

        return join_uri(self.artifact_root_uri, [STATUS_DOCUMENT_FILENAME])

    def relative_key(self, uri: str) -> str:
        """Return an artifact URI relative to the artifact root."""

        root = self.artifact_root_uri.rstrip("/")
        if uri == root:
            return ""
        prefix = f"{root}/"
        if not uri.startswith(prefix):
            raise ValueError(f"Artifact URI is not under root: uri={uri!r} root={self.artifact_root_uri!r}")
        return uri[len(prefix) :]
