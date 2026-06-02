"""Idempotent data manifest publisher."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping

from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec, PipelineConfig
from ..runtime import ExecutionContext
from .build import build_cycle_manifest, build_manifest_artifacts
from .data_manifest_refresh import maybe_publish_data_manifest
from .marker_evidence import collect_publish_marker_evidence
from .promotion import promote_built_manifest, promote_existing_published_run
from .readiness import check_publish_readiness


@dataclass(frozen=True)
class PublishResult:
    """Outcome of a publish attempt for one dataset cycle."""

    ready: bool
    already_published: bool
    latest_promoted: bool = False
    run_id: str | None = None
    missing_markers: tuple[str, ...] = ()
    marker_errors: tuple[str, ...] = ()
    validation_errors: tuple[str, ...] = ()


def run_publish(
    *,
    ctx: ExecutionContext,
    cycle: str,
    run_id: str | None = None,
    dataset_label: str,
    artifact_ids: Iterable[str],
    artifact_specs: Mapping[str, ArtifactSpec],
    artifact_repo: ArtifactRepository,
    pipeline_config: PipelineConfig | None = None,
    forecast_catalog: Mapping | None = None,
) -> PublishResult:
    """Publish a cycle manifest when all requested success markers exist."""

    readiness = check_publish_readiness(
        ctx=ctx,
        cycle=cycle,
        run_id=run_id,
        artifact_ids=artifact_ids,
        artifact_repo=artifact_repo,
    )
    if not readiness.ready:
        return PublishResult(
            ready=False,
            already_published=False,
            run_id=readiness.run_id,
            marker_errors=readiness.marker_errors,
            validation_errors=readiness.validation_errors,
        )

    resolved_run_id = readiness.run_id
    if resolved_run_id is None:
        print("Publish not ready: no run found")
        return PublishResult(ready=False, already_published=False)

    generated_at = _utc_now_iso()
    existing_promotion = promote_existing_published_run(
        artifacts=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
    )
    if existing_promotion is not None:
        maybe_publish_data_manifest(
            artifacts=artifact_repo,
            dataset_id=ctx.dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
            revision=existing_promotion.revision,
            latest_promoted=existing_promotion.latest_promoted,
            pipeline_config=pipeline_config,
            forecast_catalog=forecast_catalog,
            generated_at=generated_at,
        )
        print(
            "Already published (reused run manifest): "
            f"{artifact_repo.paths.published_marker_uri(dataset_id=ctx.dataset_id, cycle=cycle, run_id=resolved_run_id)}"
        )
        print(f"Published: {existing_promotion.public_manifest_uri}")
        return PublishResult(
            ready=True,
            already_published=existing_promotion.already_published,
            latest_promoted=existing_promotion.latest_promoted,
            run_id=resolved_run_id,
        )

    marker_evidence = collect_publish_marker_evidence(
        artifact_repo=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        frames=readiness.frames,
        artifact_ids=readiness.artifact_ids,
    )
    if not marker_evidence.ready:
        return PublishResult(
            ready=False,
            already_published=False,
            run_id=resolved_run_id,
            missing_markers=marker_evidence.missing_markers,
            marker_errors=marker_evidence.marker_errors,
        )

    print(f"Publish building manifest dataset_id={ctx.dataset_id} cycle={cycle} run_id={resolved_run_id}", flush=True)
    manifest_artifacts = build_manifest_artifacts(
        artifact_repo=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        frames=readiness.frames,
        artifact_ids=readiness.artifact_ids,
        artifact_specs=artifact_specs,
        marker_cache=marker_evidence.marker_cache,
    )

    manifest_obj = build_cycle_manifest(
        dataset_id=ctx.dataset_id,
        dataset_label=dataset_label,
        cycle=cycle,
        run_id=resolved_run_id,
        payload_root=artifact_repo.paths.field_payload_root_key(
            dataset_id=ctx.dataset_id,
            cycle=cycle,
            run_id=resolved_run_id,
        ),
        generated_at=generated_at,
        frames=readiness.frames,
        artifacts=manifest_artifacts,
    )

    promotion = promote_built_manifest(
        artifacts=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        manifest_obj=manifest_obj,
        generated_at=generated_at,
    )

    maybe_publish_data_manifest(
        artifacts=artifact_repo,
        dataset_id=ctx.dataset_id,
        cycle=cycle,
        run_id=resolved_run_id,
        revision=promotion.revision,
        latest_promoted=promotion.latest_promoted,
        pipeline_config=pipeline_config,
        forecast_catalog=forecast_catalog,
        generated_at=generated_at,
    )

    print(f"Published: {promotion.public_manifest_uri}")
    return PublishResult(
        ready=True,
        already_published=promotion.already_published,
        latest_promoted=promotion.latest_promoted,
        run_id=resolved_run_id,
    )


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
