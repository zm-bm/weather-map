"""Manifest promotion and pointer write stages."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from ..artifacts.published_schema import published_marker_dict
from ..artifacts.repository import ArtifactRepository
from .inspect import manifest_info_from_obj
from .pointers import CURRENT_POINTER_SCHEMA, LATEST_POINTER_SCHEMA, manifest_pointer_dict, parse_manifest_pointer


@dataclass(frozen=True)
class ManifestPromotion:
    """Result of promoting one run manifest and its public aliases."""

    already_published: bool
    latest_promoted: bool
    public_manifest_uri: str
    revision: str
    manifest: dict[str, Any]
    reused_existing_run: bool = False


def promote_existing_published_run(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> ManifestPromotion | None:
    """Repair public aliases from an already published internal run manifest."""

    if not artifacts.published_marker_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return None
    if not artifacts.run_manifest_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return None

    try:
        published_marker = artifacts.read_published_marker(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        manifest_obj = artifacts.read_run_manifest(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        print(f"Unable to reuse existing published run; republishing from markers: {exc}")
        return None

    run = manifest_obj.get("run") if isinstance(manifest_obj, Mapping) else None
    revision = run.get("revision") if isinstance(run, Mapping) else None
    manifest_run_id = run.get("run_id") if isinstance(run, Mapping) else None
    if not isinstance(revision, str) or published_marker.revision != revision:
        return None
    if manifest_run_id != run_id:
        print(
            "Unable to reuse existing published run; run manifest run_id mismatch.\n"
            f"  expected={run_id!r}\n"
            f"  found={manifest_run_id!r}"
        )
        return None

    public_manifest_uri = artifacts.write_public_run_manifest(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        manifest=manifest_obj,
    )
    current_pointer = manifest_pointer_for_manifest(
        artifacts=artifacts,
        schema_name=CURRENT_POINTER_SCHEMA,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        manifest_obj=manifest_obj,
        public_manifest_uri=public_manifest_uri,
    )
    if not cycle_current_pointer_matches_revision(
        artifacts=artifacts,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        revision=revision,
    ):
        artifacts.write_cycle_current_pointer(dataset_id=dataset_id, cycle=cycle, pointer=current_pointer)

    latest_promoted = maybe_promote_latest(
        artifacts=artifacts,
        dataset_id=dataset_id,
        cycle=cycle,
        latest_pointer=manifest_pointer_for_manifest(
            artifacts=artifacts,
            schema_name=LATEST_POINTER_SCHEMA,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            manifest_obj=manifest_obj,
            public_manifest_uri=public_manifest_uri,
        ),
    )
    return ManifestPromotion(
        already_published=True,
        latest_promoted=latest_promoted,
        public_manifest_uri=public_manifest_uri,
        revision=revision,
        manifest=manifest_obj,
        reused_existing_run=True,
    )


def promote_built_manifest(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    manifest_obj: dict[str, Any],
    generated_at: str,
) -> ManifestPromotion:
    """Write internal/public manifests, aliases, and the published marker."""

    revision = str(manifest_obj["run"]["revision"])
    already_published = is_already_published(
        artifacts=artifacts,
        dataset_id=dataset_id,
        run_id=run_id,
        revision=revision,
        cycle=cycle,
    )

    manifest_to_publish = manifest_obj
    if already_published:
        manifest_to_publish = artifacts.read_run_manifest(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    else:
        artifacts.write_run_manifest(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            manifest=manifest_obj,
        )

    public_manifest_uri = artifacts.write_public_run_manifest(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        manifest=manifest_to_publish,
    )
    current_pointer = manifest_pointer_for_manifest(
        artifacts=artifacts,
        schema_name=CURRENT_POINTER_SCHEMA,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        manifest_obj=manifest_to_publish,
        public_manifest_uri=public_manifest_uri,
    )
    artifacts.write_cycle_current_pointer(dataset_id=dataset_id, cycle=cycle, pointer=current_pointer)

    latest_promoted = maybe_promote_latest(
        artifacts=artifacts,
        dataset_id=dataset_id,
        cycle=cycle,
        latest_pointer=manifest_pointer_for_manifest(
            artifacts=artifacts,
            schema_name=LATEST_POINTER_SCHEMA,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            manifest_obj=manifest_to_publish,
            public_manifest_uri=public_manifest_uri,
        ),
    )
    published_revision = str(manifest_to_publish["run"]["revision"])
    if not already_published:
        artifacts.write_published_marker(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            marker=published_marker_dict(
                cycle=cycle,
                dataset_id=dataset_id,
                generated_at=generated_at,
                revision=published_revision,
                manifest_uri=public_manifest_uri,
            ),
        )

    return ManifestPromotion(
        already_published=already_published,
        latest_promoted=latest_promoted,
        public_manifest_uri=public_manifest_uri,
        revision=published_revision,
        manifest=manifest_to_publish,
    )


def is_already_published(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    run_id: str,
    revision: str,
    cycle: str,
) -> bool:
    """Return whether the published marker matches the new manifest revision."""

    published_uri = artifacts.paths.published_marker_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    if not artifacts.published_marker_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return False

    try:
        previous = artifacts.read_published_marker(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        print(f"Unable to parse existing publish marker {published_uri}; republishing: {exc}")
        return False

    previous_revision = previous.revision
    if previous_revision == revision and artifacts.run_manifest_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
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


def manifest_pointer_for_manifest(
    *,
    artifacts: ArtifactRepository,
    schema_name: str,
    dataset_id: str,
    cycle: str,
    manifest_obj: Mapping[str, Any],
    run_id: str,
    public_manifest_uri: str,
) -> dict[str, Any]:
    run = manifest_obj.get("run") if isinstance(manifest_obj, Mapping) else None
    revision = run.get("revision") if isinstance(run, Mapping) else None
    generated_at = run.get("generated_at") if isinstance(run, Mapping) else None
    if not isinstance(revision, str) or not isinstance(generated_at, str):
        raise SystemExit("Cannot publish manifest pointer without run revision and generated_at")
    return manifest_pointer_dict(
        schema_name=schema_name,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        revision=revision,
        generated_at=generated_at,
        manifest_path=artifacts.paths.relative_key(public_manifest_uri),
    )


def maybe_promote_latest(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    latest_pointer: Mapping[str, Any],
) -> bool:
    """Promote the cycle manifest to latest unless latest is a newer cycle."""

    current_latest_cycle = read_latest_cycle(artifacts=artifacts, dataset_id=dataset_id)
    if current_latest_cycle is None or cycle >= current_latest_cycle:
        revision = latest_pointer.get("revision") if isinstance(latest_pointer, Mapping) else None
        run_id = latest_pointer.get("run_id") if isinstance(latest_pointer, Mapping) else None
        if isinstance(revision, str) and isinstance(run_id, str) and latest_pointer_matches_revision(
            artifacts=artifacts,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            revision=revision,
        ):
            return False
        artifacts.write_latest_pointer(dataset_id=dataset_id, pointer=latest_pointer)
        return True

    print(
        "Skipping latest manifest promotion for older cycle.\n"
        f"  cycle={cycle}\n"
        f"  current_latest_cycle={current_latest_cycle}"
    )
    return False


def cycle_current_pointer_matches_revision(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    revision: str,
) -> bool:
    if not artifacts.cycle_current_pointer_exists(dataset_id=dataset_id, cycle=cycle):
        return False
    try:
        pointer = artifacts.read_cycle_current_pointer(dataset_id=dataset_id, cycle=cycle)
    except (Exception, SystemExit):
        return False
    if pointer.get("schema") != CURRENT_POINTER_SCHEMA:
        return False
    info = manifest_info_from_obj(pointer)
    return info is not None and info.cycle == cycle and info.run_id == run_id and info.revision == revision


def latest_pointer_matches_revision(
    *,
    artifacts: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    revision: str,
) -> bool:
    if not artifacts.latest_manifest_exists(dataset_id=dataset_id):
        return False
    try:
        pointer = artifacts.read_latest_pointer(dataset_id=dataset_id)
    except (Exception, SystemExit):
        return False
    if pointer.get("schema") != LATEST_POINTER_SCHEMA:
        return False
    info = manifest_info_from_obj(pointer)
    return info is not None and info.cycle == cycle and info.run_id == run_id and info.revision == revision


def read_latest_cycle(*, artifacts: ArtifactRepository, dataset_id: str) -> str | None:
    """Read the current latest manifest cycle, if available and parseable."""

    latest_manifest_uri = artifacts.paths.manifest_latest_uri(dataset_id=dataset_id)
    if not artifacts.latest_manifest_exists(dataset_id=dataset_id):
        return None

    try:
        latest = artifacts.read_latest_pointer(dataset_id=dataset_id)
    except Exception as exc:
        print(f"Unable to read current latest manifest {latest_manifest_uri}: {exc}")
        raise SystemExit(f"Unable to read current latest manifest {latest_manifest_uri}: {exc}") from exc

    pointer = parse_manifest_pointer(latest, expected_schema=LATEST_POINTER_SCHEMA, uri=latest_manifest_uri)
    return pointer.cycle
