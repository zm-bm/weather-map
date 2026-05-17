"""Idempotent forecast manifest publisher."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping

from ..artifacts.published_schema import published_marker_dict
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec, PipelineConfig
from ..runtime import ExecutionContext
from .availability import publish_availability_index
from .build import build_cycle_manifest, build_manifest_artifacts
from .inspect import manifest_info_from_obj


@dataclass(frozen=True)
class PublishResult:
    """Outcome of a publish attempt for one model cycle."""

    ready: bool
    already_published: bool
    missing_markers: tuple[str, ...] = ()


def run_publish(
    *,
    ctx: ExecutionContext,
    cycle: str,
    model_label: str,
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    artifact_repo: ArtifactRepository,
    pipeline_config: PipelineConfig | None = None,
) -> PublishResult:
    """Publish a cycle manifest when all requested success markers exist."""

    fhours = tuple(ctx.forecast_hours or ())
    artifact_ids = tuple(artifact_ids)

    if not fhours:
        print("Publish not ready: ctx.forecast_hours is empty")
        return PublishResult(ready=False, already_published=False)

    if not artifact_ids:
        print("Publish not ready: workload.artifacts is empty")
        return PublishResult(ready=False, already_published=False)

    missing = artifact_repo.missing_success_markers(
        model_id=ctx.model_id,
        cycle=cycle,
        fhours=fhours,
        artifact_ids=artifact_ids,
    )
    if missing:
        print(f"Publish not ready: missing {len(missing)} success markers")
        for marker in missing[:10]:
            print(f"missing: {marker}")
        if len(missing) > 10:
            print(f"... and {len(missing) - 10} more")
        return PublishResult(ready=False, already_published=False, missing_markers=tuple(missing))

    manifest_artifacts = build_manifest_artifacts(
        artifact_repo=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        fhours=fhours,
        artifact_ids=artifact_ids,
        artifact_specs=artifact_specs,
    )

    generated_at = _utc_now_iso()
    manifest_obj = build_cycle_manifest(
        model_id=ctx.model_id,
        model_label=model_label,
        cycle=cycle,
        generated_at=generated_at,
        fhours=fhours,
        artifacts=manifest_artifacts,
    )
    revision = str(manifest_obj["run"]["revision"])

    cycle_manifest_uri = artifact_repo.paths.manifest_cycle_uri(model_id=ctx.model_id, cycle=cycle)
    already_published = _is_already_published(
        artifacts=artifact_repo,
        model_id=ctx.model_id,
        revision=revision,
        cycle=cycle,
    )

    manifest_to_publish = manifest_obj
    if already_published:
        manifest_to_publish = artifact_repo.read_cycle_manifest(model_id=ctx.model_id, cycle=cycle)
    else:
        cycle_manifest_uri = artifact_repo.write_cycle_manifest(model_id=ctx.model_id, cycle=cycle, manifest=manifest_obj)

    _maybe_promote_latest(
        artifacts=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        manifest_obj=manifest_to_publish,
    )
    if pipeline_config is not None:
        availability_index_uri = publish_availability_index(
            pipeline_config=pipeline_config,
            artifact_repo=artifact_repo,
            generated_at=generated_at,
        )
        print(f"Published availability index: {availability_index_uri}")

    if not already_published:
        artifact_repo.write_published_marker(
            model_id=ctx.model_id,
            cycle=cycle,
            marker=published_marker_dict(
                cycle=cycle,
                model=ctx.model_id,
                generated_at=generated_at,
                revision=revision,
                manifest_uri=cycle_manifest_uri,
            ),
        )

    print(f"Published: {cycle_manifest_uri}")
    return PublishResult(ready=True, already_published=already_published)


def _is_already_published(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    revision: str,
    cycle: str,
) -> bool:
    """Return whether the published marker matches the new manifest revision."""

    published_uri = artifacts.paths.published_marker_uri(model_id=model_id, cycle=cycle)
    if not artifacts.published_marker_exists(model_id=model_id, cycle=cycle):
        return False

    try:
        previous = artifacts.read_published_marker(model_id=model_id, cycle=cycle)
    except (Exception, SystemExit) as exc:
        print(f"Unable to parse existing publish marker {published_uri}; republishing: {exc}")
        return False

    previous_revision = previous.revision
    if previous_revision == revision and artifacts.cycle_manifest_exists(model_id=model_id, cycle=cycle):
        print(f"Already published (same revisions): {published_uri}")
        return True

    print(
        "Publish marker exists but revision differs; republishing.\n"
        f"  cycle={cycle}\n"
        f"  prev_revision={previous_revision!r}\n"
        f"  new_revision={revision!r}\n"
        f"  marker={published_uri}"
    )
    return False


def _maybe_promote_latest(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    manifest_obj: dict,
) -> None:
    """Promote the cycle manifest to latest unless latest is a newer cycle."""

    current_latest_cycle = _read_latest_cycle(artifacts=artifacts, model_id=model_id)
    if current_latest_cycle is None or cycle >= current_latest_cycle:
        artifacts.write_latest_manifest(model_id=model_id, manifest=manifest_obj)
        return

    print(
        "Skipping latest manifest promotion for older cycle.\n"
        f"  cycle={cycle}\n"
        f"  current_latest_cycle={current_latest_cycle}"
    )


def _read_latest_cycle(*, artifacts: ArtifactRepository, model_id: str) -> str | None:
    """Read the current latest manifest cycle, if available and parseable."""

    latest_manifest_uri = artifacts.paths.manifest_latest_uri(model_id=model_id)
    if not artifacts.latest_manifest_exists(model_id=model_id):
        return None

    try:
        latest = artifacts.read_latest_manifest(model_id=model_id)
    except Exception as exc:
        print(f"Unable to read current latest manifest {latest_manifest_uri}: {exc}")
        return None

    info = manifest_info_from_obj(latest)
    return info.cycle if info is not None else None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
