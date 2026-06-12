"""Rolling observed dataset manifest publisher."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from ...config.pipeline import DatasetConfig, DatasetLifecycleConfig
from ...config.product import LoadedProductConfig
from ...core.cycles import latest_synoptic_cycles, parse_cycle
from ...core.timestamps import as_utc, isoformat_utc, parse_iso_datetime_utc, utc_now_iso
from ..artifacts.repository import ArtifactRepository
from .build import build_cycle_manifest
from .index import publish_index
from .schema import CycleManifest, ManifestArtifact, ManifestFrameEntry

_HOURLY_CYCLE_HOURS = tuple(range(24))


@dataclass(frozen=True)
class RollingObservedPublishResult:
    """Outcome of publishing a rolling observed latest manifest."""

    ready: bool
    published: bool
    dataset_id: str
    run_id: str | None = None
    frame_count: int = 0
    message: str | None = None


@dataclass(frozen=True)
class _PublishedObservedManifest:
    cycle: str
    run_id: str
    manifest: CycleManifest


@dataclass(frozen=True)
class _RollingPayloadMaterialization:
    frame_id: str
    payload_file: str
    source_path: str
    byte_length: int
    sha256: str


@dataclass(frozen=True)
class _RollingManifestBuild:
    manifest: CycleManifest
    payloads: tuple[_RollingPayloadMaterialization, ...]


def publish_rolling_observed_latest(
    *,
    product_config: LoadedProductConfig,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    now: datetime | None = None,
    generated_at: str | None = None,
) -> RollingObservedPublishResult:
    """Publish a rolling latest manifest for a rolling observed dataset."""

    dataset = product_config.dataset(dataset_id)
    lifecycle = dataset.lifecycle
    if lifecycle is None or lifecycle.type != "rolling_observed":
        raise SystemExit(f"Dataset {dataset_id!r} is not configured with rolling_observed lifecycle")

    generated_at = generated_at or utc_now_iso()
    candidates = _read_published_manifests(
        artifact_repo=artifact_repo,
        dataset=dataset,
        lifecycle=lifecycle,
        now=now,
    )
    if not candidates:
        return RollingObservedPublishResult(
            ready=False,
            published=False,
            dataset_id=dataset_id,
            message=f"No published {dataset_id} manifests found in rolling observed scan window",
        )

    rolling_build = _build_rolling_manifest(
        artifact_repo=artifact_repo,
        dataset=dataset,
        lifecycle=lifecycle,
        candidates=candidates,
        generated_at=generated_at,
    )
    rolling_manifest = rolling_build.manifest

    try:
        current_latest = artifact_repo.read_latest_manifest(dataset_id=dataset_id)
    except (FileNotFoundError, ValueError, SystemExit):
        current_latest = None

    if current_latest is not None and _same_manifest_revision(current_latest, rolling_manifest):
        return RollingObservedPublishResult(
            ready=True,
            published=False,
            dataset_id=dataset_id,
            run_id=rolling_manifest.run_id,
            frame_count=len(rolling_manifest.frames),
            message="Rolling observed latest manifest is already current",
        )

    try:
        current_newest_valid_at = _newest_frame_valid_at(current_latest) if current_latest is not None else None
    except ValueError:
        current_newest_valid_at = None
    candidate_newest_valid_at = _newest_frame_valid_at(rolling_manifest)
    if current_newest_valid_at is not None and current_newest_valid_at > candidate_newest_valid_at:
        return RollingObservedPublishResult(
            ready=True,
            published=False,
            dataset_id=dataset_id,
            run_id=rolling_manifest.run_id,
            frame_count=len(rolling_manifest.frames),
            message="Current rolling observed latest is newer than candidate; skipping no-regression publish",
        )

    for payload in rolling_build.payloads:
        artifact_repo.materialize_rolling_payload(
            dataset_id=dataset.id,
            frame_id=payload.frame_id,
            payload_file=payload.payload_file,
            source_path=payload.source_path,
            byte_length=payload.byte_length,
            sha256=payload.sha256,
        )

    latest_uri = artifact_repo.write_latest_manifest(dataset_id=dataset_id, manifest=rolling_manifest)
    index_uri = publish_index(
        product_config=product_config,
        artifact_repo=artifact_repo,
        generated_at=generated_at,
        strict_dataset_ids=(dataset_id,),
    )
    print(f"Published rolling observed latest manifest: {latest_uri}", flush=True)
    print(f"Published manifest index: {index_uri}", flush=True)
    return RollingObservedPublishResult(
        ready=True,
        published=True,
        dataset_id=dataset_id,
        run_id=rolling_manifest.run_id,
        frame_count=len(rolling_manifest.frames),
    )


def _read_published_manifests(
    *,
    artifact_repo: ArtifactRepository,
    dataset: DatasetConfig,
    lifecycle: DatasetLifecycleConfig,
    now: datetime | None,
) -> tuple[_PublishedObservedManifest, ...]:
    cycles = _scan_cycles(lifecycle=lifecycle, now=now)
    manifests: list[_PublishedObservedManifest] = []
    for cycle in cycles:
        parse_cycle(cycle)
        for run_id in artifact_repo.list_run_ids(dataset_id=dataset.id, cycle=cycle):
            if not artifact_repo.publication_exists(dataset_id=dataset.id, cycle=cycle, run_id=run_id):
                continue
            try:
                publication = artifact_repo.read_publication(dataset_id=dataset.id, cycle=cycle, run_id=run_id)
                manifest = artifact_repo.read_public_run_manifest(dataset_id=dataset.id, cycle=cycle, run_id=run_id)
            except (FileNotFoundError, ValueError, SystemExit) as exc:
                print(
                    f"Skipping incompatible published observed manifest "
                    f"dataset_id={dataset.id} cycle={cycle} run_id={run_id}: {exc}",
                    flush=True,
                )
                continue
            if publication.revision != manifest.revision:
                continue
            manifests.append(_PublishedObservedManifest(cycle=cycle, run_id=run_id, manifest=manifest))
    return tuple(manifests)


def _scan_cycles(*, lifecycle: DatasetLifecycleConfig, now: datetime | None) -> tuple[str, ...]:
    scan_count = max(1, math.ceil(lifecycle.publish_scan_minutes / 60)) + 2
    return latest_synoptic_cycles(
        now=as_utc(now or datetime.now(timezone.utc)),
        count=scan_count,
        cycle_hours=_HOURLY_CYCLE_HOURS,
    )


def _build_rolling_manifest(
    *,
    artifact_repo: ArtifactRepository,
    dataset: DatasetConfig,
    lifecycle: DatasetLifecycleConfig,
    candidates: tuple[_PublishedObservedManifest, ...],
    generated_at: str,
) -> _RollingManifestBuild:
    frame_sources = _select_window_frames(lifecycle=lifecycle, candidates=candidates)
    frame_ids = tuple(frame.id for frame, _source in frame_sources)
    if not frame_ids:
        raise SystemExit(f"No {dataset.id} frames remain inside rolling observed display window")

    newest_frame = frame_sources[-1][0]
    newest_valid_at = parse_iso_datetime_utc(newest_frame.valid_at)
    run_id = _rolling_run_id(
        newest_valid_at=newest_valid_at,
        frame_sources=frame_sources,
    )
    payload_root = artifact_repo.paths.rolling_payload_root_key(dataset_id=dataset.id)
    artifacts, payloads = _merge_artifacts(
        artifact_repo=artifact_repo,
        dataset_id=dataset.id,
        frame_sources=frame_sources,
    )
    frame_valid_times = {frame.id: frame.valid_at for frame, _source in frame_sources}

    return _RollingManifestBuild(
        manifest=build_cycle_manifest(
            dataset_id=dataset.id,
            dataset_label=dataset.label,
            cycle=newest_valid_at.strftime("%Y%m%d%H"),
            run_id=run_id,
            payload_root=payload_root,
            generated_at=generated_at,
            frames=frame_ids,
            artifacts=artifacts,
            frame_valid_times=frame_valid_times,
        ),
        payloads=payloads,
    )


def _select_window_frames(
    *,
    lifecycle: DatasetLifecycleConfig,
    candidates: tuple[_PublishedObservedManifest, ...],
) -> tuple[tuple[ManifestFrameEntry, _PublishedObservedManifest], ...]:
    deduped: dict[str, tuple[ManifestFrameEntry, _PublishedObservedManifest]] = {}
    sorted_sources = sorted(
        candidates,
        key=lambda source: (
            source.manifest.generated_at_utc,
            source.cycle,
            source.run_id,
            source.manifest.revision,
        ),
    )
    for source in sorted_sources:
        for frame in source.manifest.frames:
            deduped[frame.id] = (frame, source)

    ordered = sorted(
        deduped.values(),
        key=lambda entry: (
            parse_iso_datetime_utc(entry[0].valid_at),
            entry[0].id,
            entry[1].cycle,
            entry[1].run_id,
        ),
    )
    if not ordered:
        return ()

    newest_valid_at = parse_iso_datetime_utc(ordered[-1][0].valid_at)
    cutoff = newest_valid_at - timedelta(minutes=lifecycle.display_window_minutes)
    return tuple(
        (frame, source)
        for frame, source in ordered
        if parse_iso_datetime_utc(frame.valid_at) >= cutoff
    )


def _merge_artifacts(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    frame_sources: tuple[tuple[ManifestFrameEntry, _PublishedObservedManifest], ...],
) -> tuple[dict[str, dict[str, Any]], tuple[_RollingPayloadMaterialization, ...]]:
    baseline_artifacts = frame_sources[0][1].manifest.artifacts
    merged: dict[str, dict[str, Any]] = {}
    payloads: list[_RollingPayloadMaterialization] = []
    for artifact_id, baseline_artifact in baseline_artifacts.items():
        baseline_meta = _artifact_metadata(artifact=baseline_artifact)
        frames: dict[str, dict[str, Any]] = {}
        for frame, source in frame_sources:
            artifact = source.manifest.artifacts.get(artifact_id)
            if artifact is None:
                raise SystemExit(
                    f"Rolling observed manifest source missing artifact {artifact_id!r}: "
                    f"cycle={source.cycle} run_id={source.run_id}"
                )
            if _artifact_metadata(artifact=artifact) != baseline_meta:
                raise SystemExit(
                    "Rolling observed artifact metadata mismatch: "
                    f"artifact={artifact_id!r} cycle={source.cycle} run_id={source.run_id}"
                )
            source_frame = artifact.frames.get(frame.id)
            if source_frame is None:
                raise SystemExit(
                    f"Rolling observed artifact {artifact_id!r} missing frame {frame.id!r}: "
                    f"cycle={source.cycle} run_id={source.run_id}"
                )
            materialized_path = _materialized_payload_path(
                artifact_repo=artifact_repo,
                dataset_id=dataset_id,
                frame_id=frame.id,
                payload_file=artifact.payload_file,
            )
            payloads.append(_RollingPayloadMaterialization(
                frame_id=frame.id,
                payload_file=artifact.payload_file,
                source_path=source_frame.path,
                byte_length=source_frame.byte_length,
                sha256=source_frame.sha256,
            ))
            frames[frame.id] = {
                "path": materialized_path,
                "byte_length": source_frame.byte_length,
                "sha256": source_frame.sha256,
            }

        merged[artifact_id] = {
            **baseline_meta,
            "frames": frames,
        }
    return merged, tuple(payloads)


def _materialized_payload_path(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    frame_id: str,
    payload_file: str,
) -> str:
    return artifact_repo.paths.relative_key(
        artifact_repo.paths.rolling_payload_uri_parts(
            dataset_id=dataset_id,
            frame_id=frame_id,
            payload_file=payload_file,
        )
    )


def _artifact_metadata(*, artifact: ManifestArtifact) -> dict[str, Any]:
    return artifact.model_dump(mode="json", exclude_none=True, exclude={"frames"})


def _rolling_run_id(
    *,
    newest_valid_at: datetime,
    frame_sources: tuple[tuple[ManifestFrameEntry, _PublishedObservedManifest], ...],
) -> str:
    basis = {
        "frames": [
            {
                "id": frame.id,
                "valid_at": isoformat_utc(parse_iso_datetime_utc(frame.valid_at)),
                "cycle": source.cycle,
                "run_id": source.run_id,
                "revision": source.manifest.revision,
            }
            for frame, source in frame_sources
        ],
        "artifacts": sorted(frame_sources[-1][1].manifest.artifacts),
    }
    digest = hashlib.sha1(json.dumps(basis, sort_keys=True).encode("utf-8")).hexdigest()[:8]
    return f"{as_utc(newest_valid_at).strftime('%Y%m%dT%H%M%SZ')}-{digest}"


def _same_manifest_revision(left: CycleManifest, right: CycleManifest) -> bool:
    return left.cycle == right.cycle and left.run_id == right.run_id and left.revision == right.revision


def _newest_frame_valid_at(manifest: CycleManifest) -> datetime:
    return max(parse_iso_datetime_utc(frame.valid_at) for frame in manifest.frames)
