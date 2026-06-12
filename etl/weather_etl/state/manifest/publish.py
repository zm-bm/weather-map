"""Idempotent cycle manifest publisher."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Mapping

from ...config.pipeline import ArtifactSpec
from ...core.timestamps import utc_now_iso
from ...environment.context import ExecutionContext
from ..artifacts.publication_schema import run_publication_marker_dict
from ..artifacts.repository import ArtifactRepository
from .build import build_cycle_manifest, build_manifest_artifacts
from .publish_gate import PublishGateResult, check_publish_gate
from .publish_markers import PublishMarkerSet, collect_publish_markers
from .schema import CycleManifest


@dataclass(frozen=True)
class RunManifestPublishResult:
    """Outcome of publishing one immutable run manifest."""

    ready: bool
    already_published: bool
    run_id: str | None = None
    missing_markers: tuple[str, ...] = ()
    run_errors: tuple[str, ...] = ()
    marker_errors: tuple[str, ...] = ()
    validation_errors: tuple[str, ...] = ()

    @property
    def outcome(self) -> Literal["not_ready", "already_published", "published"]:
        if not self.ready:
            return "not_ready"
        if self.already_published:
            return "already_published"
        return "published"

    @property
    def newly_published(self) -> bool:
        return self.outcome == "published"


@dataclass(frozen=True)
class _PublishTarget:
    artifacts: ArtifactRepository
    dataset_id: str
    cycle: str
    run_id: str

    @property
    def publication_uri(self) -> str:
        return self.artifacts.paths.publication_uri(
            dataset_id=self.dataset_id,
            cycle=self.cycle,
            run_id=self.run_id,
        )

    @property
    def payload_root_key(self) -> str:
        return self.artifacts.paths.payload_root_key(
            dataset_id=self.dataset_id,
            cycle=self.cycle,
            run_id=self.run_id,
        )


def publish_run_manifest(
    *,
    ctx: ExecutionContext,
    cycle: str,
    run_id: str | None = None,
    dataset_label: str,
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    artifact_repo: ArtifactRepository,
    frame_valid_times: Mapping[str, str] | None = None,
) -> RunManifestPublishResult:
    """Publish one immutable run manifest when all requested success markers exist."""

    gate = check_publish_gate(
        ctx=ctx,
        cycle=cycle,
        run_id=run_id,
        artifact_ids=artifact_ids,
        artifact_repo=artifact_repo,
    )
    if not gate.ready:
        return RunManifestPublishResult(
            ready=False,
            already_published=False,
            run_id=gate.run_id,
            run_errors=gate.run_errors,
            validation_errors=gate.validation_errors,
        )

    assert gate.run_id is not None, "Publish gate returned ready without a run id"

    generated_at = utc_now_iso()
    target = _PublishTarget(
        artifacts=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=gate.run_id,
    )

    manifest = _read_published_run_manifest(target)
    already_published = manifest is not None
    if manifest is None:
        publish_markers = collect_publish_markers(
            artifact_repo=target.artifacts,
            dataset_id=target.dataset_id,
            cycle=target.cycle,
            run_id=target.run_id,
            frames=gate.frames,
            artifact_ids=gate.artifact_ids,
        )
        if not publish_markers.ready:
            return RunManifestPublishResult(
                ready=False,
                already_published=False,
                run_id=target.run_id,
                missing_markers=publish_markers.missing_markers,
                marker_errors=publish_markers.marker_errors,
            )

        manifest = _build_manifest_from_markers(
            target=target,
            gate=gate,
            publish_markers=publish_markers,
            dataset_label=dataset_label,
            artifact_specs=artifact_specs,
            generated_at=generated_at,
            frame_valid_times=frame_valid_times,
        )
        existing_manifest = _matching_published_run_manifest(target, revision=manifest.revision)
        already_published = existing_manifest is not None
        manifest = existing_manifest or manifest

    return _commit_run_manifest_publish(
        target=target,
        manifest=manifest,
        already_published=already_published,
        generated_at=generated_at,
    )


def _read_published_run_manifest(target: _PublishTarget) -> CycleManifest | None:
    """Return the published run manifest when its publication marker is usable."""

    try:
        publication = target.artifacts.read_publication(
            dataset_id=target.dataset_id,
            cycle=target.cycle,
            run_id=target.run_id,
        )
        manifest = target.artifacts.read_run_manifest(
            dataset_id=target.dataset_id,
            cycle=target.cycle,
            run_id=target.run_id,
        )
    except FileNotFoundError:
        return None
    except (ValueError, SystemExit) as exc:
        print(f"Unable to reuse existing publication {target.publication_uri}; republishing: {exc}")
        return None

    if publication.revision != manifest.revision:
        return None

    return manifest


def _matching_published_run_manifest(target: _PublishTarget, *, revision: str) -> CycleManifest | None:
    """Return a published run manifest when it already matches the expected revision."""

    manifest = _read_published_run_manifest(target)
    if manifest is None:
        return None

    if manifest.revision == revision:
        print(f"Already published (same revisions): {target.publication_uri}")
        return manifest

    print(
        "Publication marker exists but revision differs; republishing.\n"
        f"  cycle={target.cycle}\n"
        f"  prev_revision={manifest.revision!r}\n"
        f"  new_revision={revision!r}\n"
        f"  marker={target.publication_uri}"
    )
    return None


def _build_manifest_from_markers(
    *,
    target: _PublishTarget,
    gate: PublishGateResult,
    publish_markers: PublishMarkerSet,
    dataset_label: str,
    artifact_specs: Mapping[str, ArtifactSpec],
    generated_at: str,
    frame_valid_times: Mapping[str, str] | None,
) -> CycleManifest:
    print(
        f"Publish building manifest dataset_id={target.dataset_id} cycle={target.cycle} run_id={target.run_id}",
        flush=True,
    )
    manifest_artifacts = build_manifest_artifacts(
        artifact_repo=target.artifacts,
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        frames=gate.frames,
        artifact_ids=gate.artifact_ids,
        artifact_specs=artifact_specs,
        publish_marker_cache=publish_markers.marker_cache,
    )

    return build_cycle_manifest(
        dataset_id=target.dataset_id,
        dataset_label=dataset_label,
        cycle=target.cycle,
        run_id=target.run_id,
        payload_root=target.payload_root_key,
        generated_at=generated_at,
        frames=gate.frames,
        artifacts=manifest_artifacts,
        frame_valid_times=frame_valid_times,
    )


def _commit_run_manifest_publish(
    *,
    target: _PublishTarget,
    manifest: CycleManifest,
    already_published: bool,
    generated_at: str,
) -> RunManifestPublishResult:
    if already_published:
        public_manifest_uri = target.artifacts.write_public_run_manifest(
            dataset_id=target.dataset_id,
            cycle=manifest.cycle,
            run_id=manifest.run_id,
            manifest=manifest,
        )
    else:
        public_manifest_uri = _publish_new_manifest(
            target=target,
            manifest=manifest,
            generated_at=generated_at,
        )

    if already_published:
        print(f"Already published (reused run manifest): {target.publication_uri}")
    print(f"Published: {public_manifest_uri}")
    return RunManifestPublishResult(
        ready=True,
        already_published=already_published,
        run_id=target.run_id,
    )


def _publish_new_manifest(
    *,
    target: _PublishTarget,
    manifest: CycleManifest,
    generated_at: str,
) -> str:
    """Write a newly built manifest and its publication marker."""

    target.artifacts.write_run_manifest(
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        manifest=manifest,
    )
    public_manifest_uri = target.artifacts.write_public_run_manifest(
        dataset_id=target.dataset_id,
        cycle=manifest.cycle,
        run_id=manifest.run_id,
        manifest=manifest,
    )
    target.artifacts.write_publication(
        dataset_id=target.dataset_id,
        cycle=target.cycle,
        run_id=target.run_id,
        marker=run_publication_marker_dict(
            cycle=target.cycle,
            dataset_id=target.dataset_id,
            run_id=target.run_id,
            generated_at=generated_at,
            revision=manifest.revision,
            manifest_path=target.artifacts.paths.relative_key(public_manifest_uri),
        ),
    )
    return public_manifest_uri
