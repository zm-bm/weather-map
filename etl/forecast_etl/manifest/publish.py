"""Idempotent forecast manifest publisher."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Mapping

from ..artifacts.markers_schema import ArtifactSuccessMarker, parse_artifact_success_marker
from ..artifacts.published_schema import published_marker_dict
from ..artifacts.repository import ArtifactRepository
from ..config.resolved import ArtifactSpec, PipelineConfig
from ..run_ids import validate_run_id
from ..runtime import ExecutionContext
from .build import build_cycle_manifest, build_manifest_artifacts
from .forecast_manifest import publish_forecast_manifest
from .inspect import manifest_info_from_obj


@dataclass(frozen=True)
class PublishResult:
    """Outcome of a publish attempt for one model cycle."""

    ready: bool
    already_published: bool
    latest_promoted: bool = False
    run_id: str | None = None
    missing_markers: tuple[str, ...] = ()
    marker_errors: tuple[str, ...] = ()


def run_publish(
    *,
    ctx: ExecutionContext,
    cycle: str,
    run_id: str | None = None,
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

    resolved_run_id, run_errors = _select_publish_run_id(
        artifact_repo=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        required_run_id=run_id,
    )
    if run_errors:
        print(f"Publish not ready: run selection failed for model={ctx.model_id} cycle={cycle}")
        for error in run_errors[:10]:
            print(f"run error: {error}")
        if len(run_errors) > 10:
            print(f"... and {len(run_errors) - 10} more")
        return PublishResult(
            ready=False,
            already_published=False,
            run_id=resolved_run_id,
            marker_errors=tuple(run_errors),
        )
    if resolved_run_id is None:
        print("Publish not ready: no run found")
        return PublishResult(ready=False, already_published=False)

    fast_result = _try_publish_from_existing_run(
        artifacts=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        run_id=resolved_run_id,
        pipeline_config=pipeline_config,
        generated_at=_utc_now_iso(),
    )
    if fast_result is not None:
        return fast_result

    missing = artifact_repo.missing_success_markers(
        model_id=ctx.model_id,
        cycle=cycle,
        run_id=resolved_run_id,
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

    expected_marker_count = len(fhours) * len(artifact_ids)
    print(
        f"Publish reading {expected_marker_count} success markers "
        f"model={ctx.model_id} cycle={cycle} run_id={resolved_run_id}",
        flush=True,
    )
    marker_cache, marker_errors = _read_publish_markers(
        artifact_repo=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        run_id=resolved_run_id,
        fhours=fhours,
        artifact_ids=artifact_ids,
        required_run_id=resolved_run_id,
    )
    if marker_errors:
        print(f"Publish not ready: run id marker validation failed for {len(marker_errors)} marker(s)")
        for error in marker_errors[:10]:
            print(f"marker error: {error}")
        if len(marker_errors) > 10:
            print(f"... and {len(marker_errors) - 10} more")
        return PublishResult(
            ready=False,
            already_published=False,
            run_id=resolved_run_id,
            marker_errors=tuple(marker_errors),
        )
    if resolved_run_id is None:
        print("Publish not ready: no run_id found in success markers")
        return PublishResult(ready=False, already_published=False)

    print(f"Publish building manifest model={ctx.model_id} cycle={cycle} run_id={resolved_run_id}", flush=True)
    manifest_artifacts = build_manifest_artifacts(
        artifact_repo=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        run_id=resolved_run_id,
        fhours=fhours,
        artifact_ids=artifact_ids,
        artifact_specs=artifact_specs,
        marker_cache=marker_cache,
    )

    generated_at = _utc_now_iso()
    manifest_obj = build_cycle_manifest(
        model_id=ctx.model_id,
        model_label=model_label,
        cycle=cycle,
        run_id=resolved_run_id,
        payload_root=artifact_repo.paths.field_payload_root_key(
            model_id=ctx.model_id,
            cycle=cycle,
            run_id=resolved_run_id,
        ),
        generated_at=generated_at,
        fhours=fhours,
        artifacts=manifest_artifacts,
    )
    revision = str(manifest_obj["run"]["revision"])

    run_manifest_uri = artifact_repo.paths.run_manifest_uri(model_id=ctx.model_id, cycle=cycle, run_id=resolved_run_id)
    already_published = _is_already_published(
        artifacts=artifact_repo,
        model_id=ctx.model_id,
        run_id=resolved_run_id,
        revision=revision,
        cycle=cycle,
    )

    manifest_to_publish = manifest_obj
    if already_published:
        manifest_to_publish = artifact_repo.read_run_manifest(model_id=ctx.model_id, cycle=cycle, run_id=resolved_run_id)
    else:
        run_manifest_uri = artifact_repo.write_run_manifest(
            model_id=ctx.model_id,
            cycle=cycle,
            run_id=resolved_run_id,
            manifest=manifest_obj,
        )

    cycle_manifest_uri = artifact_repo.write_cycle_manifest(
        model_id=ctx.model_id,
        cycle=cycle,
        manifest=manifest_to_publish,
    )

    latest_promoted = _maybe_promote_latest(
        artifacts=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        manifest_obj=manifest_to_publish,
    )
    revision = str(manifest_to_publish["run"]["revision"])
    if pipeline_config is not None and _should_refresh_forecast_manifest(
        artifacts=artifact_repo,
        model_id=ctx.model_id,
        cycle=cycle,
        revision=revision,
        latest_promoted=latest_promoted,
    ):
        forecast_manifest_uri = publish_forecast_manifest(
            pipeline_config=pipeline_config,
            artifact_repo=artifact_repo,
            generated_at=generated_at,
        )
        print(f"Published forecast manifest: {forecast_manifest_uri}")

    if not already_published:
        artifact_repo.write_published_marker(
            model_id=ctx.model_id,
            cycle=cycle,
            run_id=resolved_run_id,
            marker=published_marker_dict(
                cycle=cycle,
                model=ctx.model_id,
                generated_at=generated_at,
                revision=revision,
                manifest_uri=run_manifest_uri,
            ),
        )

    print(f"Published: {cycle_manifest_uri}")
    return PublishResult(
        ready=True,
        already_published=already_published,
        latest_promoted=latest_promoted,
        run_id=resolved_run_id,
    )


def _try_publish_from_existing_run(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    run_id: str,
    pipeline_config: PipelineConfig | None,
    generated_at: str,
) -> PublishResult | None:
    """Fast path for a run that already has a matching manifest and published marker."""

    if not artifacts.published_marker_exists(model_id=model_id, cycle=cycle, run_id=run_id):
        return None
    if not artifacts.run_manifest_exists(model_id=model_id, cycle=cycle, run_id=run_id):
        return None

    try:
        published_marker = artifacts.read_published_marker(model_id=model_id, cycle=cycle, run_id=run_id)
        manifest_obj = artifacts.read_run_manifest(model_id=model_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        print(f"Unable to reuse existing published run; republishing from markers: {exc}")
        return None

    run = manifest_obj.get("run") if isinstance(manifest_obj, Mapping) else None
    revision = run.get("revision") if isinstance(run, Mapping) else None
    manifest_run_id = run.get("runId") if isinstance(run, Mapping) else None
    if not isinstance(revision, str) or published_marker.revision != revision:
        return None
    if manifest_run_id != run_id:
        print(
            "Unable to reuse existing published run; run manifest runId mismatch.\n"
            f"  expected={run_id!r}\n"
            f"  found={manifest_run_id!r}"
        )
        return None

    cycle_manifest_uri = artifacts.paths.manifest_cycle_uri(model_id=model_id, cycle=cycle)
    if not _cycle_alias_matches_revision(
        artifacts=artifacts,
        model_id=model_id,
        cycle=cycle,
        revision=revision,
    ):
        cycle_manifest_uri = artifacts.write_cycle_manifest(model_id=model_id, cycle=cycle, manifest=manifest_obj)

    latest_promoted = _maybe_promote_latest(
        artifacts=artifacts,
        model_id=model_id,
        cycle=cycle,
        manifest_obj=manifest_obj,
    )
    if pipeline_config is not None and _should_refresh_forecast_manifest(
        artifacts=artifacts,
        model_id=model_id,
        cycle=cycle,
        revision=revision,
        latest_promoted=latest_promoted,
    ):
        forecast_manifest_uri = publish_forecast_manifest(
            pipeline_config=pipeline_config,
            artifact_repo=artifacts,
            generated_at=generated_at,
        )
        print(f"Published forecast manifest: {forecast_manifest_uri}")

    print(f"Already published (reused run manifest): {artifacts.paths.published_marker_uri(model_id=model_id, cycle=cycle, run_id=run_id)}")
    print(f"Published: {cycle_manifest_uri}")
    return PublishResult(
        ready=True,
        already_published=True,
        latest_promoted=latest_promoted,
        run_id=run_id,
    )


def _should_refresh_forecast_manifest(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    revision: str,
    latest_promoted: bool,
) -> bool:
    if latest_promoted:
        return True
    if not _latest_alias_matches_revision(
        artifacts=artifacts,
        model_id=model_id,
        cycle=cycle,
        revision=revision,
    ):
        return False
    return not _forecast_manifest_model_matches_revision(
        artifacts=artifacts,
        model_id=model_id,
        revision=revision,
    )


def _select_publish_run_id(
    *,
    artifact_repo: ArtifactRepository,
    model_id: str,
    cycle: str,
    required_run_id: str | None,
) -> tuple[str | None, list[str]]:
    if required_run_id is not None:
        return validate_run_id(required_run_id), []

    run_ids = artifact_repo.list_run_ids(model_id=model_id, cycle=cycle)
    if not run_ids:
        return None, [f"no runs found for model={model_id!r} cycle={cycle!r}"]
    if len(run_ids) > 1:
        return None, [f"multiple runs found for model={model_id!r} cycle={cycle!r}: {list(run_ids)!r}"]
    return run_ids[0], []


def _read_publish_markers(
    *,
    artifact_repo: ArtifactRepository,
    model_id: str,
    cycle: str,
    run_id: str,
    fhours: tuple[str, ...],
    artifact_ids: tuple[str, ...],
    required_run_id: str | None,
) -> tuple[dict[tuple[str, str], ArtifactSuccessMarker], list[str]]:
    """Read expected markers once and require one consistent run id."""

    markers: dict[tuple[str, str], ArtifactSuccessMarker] = {}
    run_ids: set[str] = set()
    errors: list[str] = []
    for artifact_id in artifact_ids:
        for fhour in fhours:
            uri = artifact_repo.paths.success_marker_uri_parts(
                model_id=model_id,
                cycle=cycle,
                run_id=run_id,
                fhour=fhour,
                artifact_id=artifact_id,
            )
            try:
                raw_marker = artifact_repo.read_json_uri(uri)
            except (Exception, SystemExit) as exc:
                errors.append(f"{uri}: {exc}")
                continue
            raw_run_id = raw_marker.get("run_id") if isinstance(raw_marker, Mapping) else None
            if not isinstance(raw_run_id, str) or not raw_run_id.strip():
                errors.append(f"{uri}: missing run_id")
                continue
            try:
                marker_run_id = validate_run_id(raw_run_id)
                run_ids.add(marker_run_id)
                markers[(artifact_id, fhour)] = parse_artifact_success_marker(raw_marker, uri=uri)
            except ValueError as exc:
                errors.append(f"{uri}: {exc}")

    if required_run_id is not None and run_ids and run_ids != {required_run_id}:
        errors.append(
            f"success markers run_id mismatch: expected={required_run_id!r} found={sorted(run_ids)!r}"
        )
    if len(run_ids) > 1:
        errors.append(f"success markers contain multiple run_id values: {sorted(run_ids)!r}")
    if errors:
        return markers, errors
    if required_run_id is not None and not run_ids:
        return markers, [f"success markers missing required run_id {required_run_id!r}"]
    return markers, []


def _is_already_published(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    run_id: str,
    revision: str,
    cycle: str,
) -> bool:
    """Return whether the published marker matches the new manifest revision."""

    published_uri = artifacts.paths.published_marker_uri(model_id=model_id, cycle=cycle, run_id=run_id)
    if not artifacts.published_marker_exists(model_id=model_id, cycle=cycle, run_id=run_id):
        return False

    try:
        previous = artifacts.read_published_marker(model_id=model_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        print(f"Unable to parse existing publish marker {published_uri}; republishing: {exc}")
        return False

    previous_revision = previous.revision
    if previous_revision == revision and artifacts.run_manifest_exists(model_id=model_id, cycle=cycle, run_id=run_id):
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
) -> bool:
    """Promote the cycle manifest to latest unless latest is a newer cycle."""

    current_latest_cycle = _read_latest_cycle(artifacts=artifacts, model_id=model_id)
    if current_latest_cycle is None or cycle >= current_latest_cycle:
        run = manifest_obj.get("run") if isinstance(manifest_obj, Mapping) else None
        revision = run.get("revision") if isinstance(run, Mapping) else None
        if isinstance(revision, str) and _latest_alias_matches_revision(
            artifacts=artifacts,
            model_id=model_id,
            cycle=cycle,
            revision=revision,
        ):
            return False
        artifacts.write_latest_manifest(model_id=model_id, manifest=manifest_obj)
        return True

    print(
        "Skipping latest manifest promotion for older cycle.\n"
        f"  cycle={cycle}\n"
        f"  current_latest_cycle={current_latest_cycle}"
    )
    return False


def _cycle_alias_matches_revision(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    revision: str,
) -> bool:
    if not artifacts.cycle_manifest_exists(model_id=model_id, cycle=cycle):
        return False
    try:
        manifest = artifacts.read_cycle_manifest(model_id=model_id, cycle=cycle)
    except (Exception, SystemExit):
        return False
    info = manifest_info_from_obj(manifest, fallback_cycle=cycle)
    return info is not None and info.cycle == cycle and info.revision == revision


def _latest_alias_matches_revision(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    cycle: str,
    revision: str,
) -> bool:
    if not artifacts.latest_manifest_exists(model_id=model_id):
        return False
    try:
        manifest = artifacts.read_latest_manifest(model_id=model_id)
    except (Exception, SystemExit):
        return False
    info = manifest_info_from_obj(manifest)
    return info is not None and info.cycle == cycle and info.revision == revision


def _forecast_manifest_model_matches_revision(
    *,
    artifacts: ArtifactRepository,
    model_id: str,
    revision: str,
) -> bool:
    if not artifacts.forecast_manifest_exists():
        return False
    try:
        forecast_manifest = artifacts.read_forecast_manifest()
    except (Exception, SystemExit):
        return False

    models = forecast_manifest.get("models") if isinstance(forecast_manifest, Mapping) else None
    model_entry = models.get(model_id) if isinstance(models, Mapping) else None
    latest = model_entry.get("latest") if isinstance(model_entry, Mapping) else None
    info = manifest_info_from_obj(latest) if isinstance(latest, Mapping) else None
    return info is not None and info.revision == revision


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
