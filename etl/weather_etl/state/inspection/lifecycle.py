"""Durable run lifecycle inspection for ETL artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, Mapping, TypeAlias

from ...storage.base import UriStore
from ..artifacts.repository import ArtifactRepository
from ..artifacts.status import summarize_cycle_progress
from ..manifest.schema import parse_cycle_manifest

if TYPE_CHECKING:
    from ..runs.snapshots import LoadedRunSnapshot

RunLifecycleStage: TypeAlias = Literal[
    "missing_snapshot",
    "invalid_snapshot",
    "pending_frames",
    "invalid_markers",
    "ready_for_validation",
    "validation_failed",
    "ready_for_publish",
    "published",
    "published_with_manifest_drift",
]


@dataclass(frozen=True)
class SnapshotInspection:
    summary: dict[str, Any]
    loaded: LoadedRunSnapshot | None


@dataclass(frozen=True)
class MarkerInspection:
    summary: dict[str, Any]


@dataclass(frozen=True)
class ValidationInspection:
    summary: dict[str, Any]


@dataclass(frozen=True)
class PublicationInspection:
    summary: dict[str, Any]


@dataclass(frozen=True)
class RunManifestInspection:
    summary: dict[str, Any]


@dataclass(frozen=True)
class PublishedManifestInspection:
    summary: dict[str, str]


@dataclass(frozen=True)
class RunLifecycleInspection:
    dataset_id: str
    cycle: str
    run_id: str
    state: str
    stage: RunLifecycleStage
    complete: bool | None
    snapshot: SnapshotInspection
    markers: MarkerInspection
    validation: ValidationInspection
    publication: PublicationInspection
    manifests: RunManifestInspection
    published_manifests: PublishedManifestInspection
    publication_ready: bool
    diagnostics: tuple[str, ...]

    def to_operator_run_dict(self) -> dict[str, Any]:
        """Return the existing operator run status JSON shape."""

        return {
            "run_id": self.run_id,
            "state": self.state,
            "stage": self.stage,
            "complete": self.complete,
            "snapshot": self.snapshot.summary,
            "markers": self.markers.summary,
            "validation": self.validation.summary,
            "published": self.publication.summary,
            "manifests": self.manifests.summary,
            "published_manifest_status": self.published_manifests.summary,
            "publication_ready": self.publication_ready,
            "diagnostics": list(self.diagnostics),
        }


def inspect_run_lifecycle(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> RunLifecycleInspection:
    """Inspect one persisted run lifecycle without mutating ETL state."""

    snapshot = _inspect_snapshot(
        artifact_repo=artifact_repo,
        store=store,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
    )
    markers = MarkerInspection(
        _marker_summary(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            snapshot=snapshot.loaded,
        )
    )
    validation = ValidationInspection(
        _validation_summary(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    )
    publication = PublicationInspection(
        _publication_summary(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    )
    manifests = RunManifestInspection(
        _manifest_summary(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    )
    published_manifests = PublishedManifestInspection(
        _published_manifest_status(
            artifact_repo=artifact_repo,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    )
    state = _run_state(snapshot=snapshot.summary, markers=markers.summary)
    publication_ready = _publication_ready(markers=markers.summary, validation=validation.summary)
    diagnostics = tuple(
        _run_diagnostics(
            snapshot=snapshot.summary,
            markers=markers.summary,
            validation=validation.summary,
            publication=publication.summary,
            published_manifest_status=published_manifests.summary,
        )
    )
    return RunLifecycleInspection(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        state=state,
        stage=_lifecycle_stage(
            snapshot=snapshot.summary,
            markers=markers.summary,
            validation=validation.summary,
            publication=publication.summary,
            published_manifest_status=published_manifests.summary,
        ),
        complete=markers.summary["complete"],
        snapshot=snapshot,
        markers=markers,
        validation=validation,
        publication=publication,
        manifests=manifests,
        published_manifests=published_manifests,
        publication_ready=publication_ready,
        diagnostics=diagnostics,
    )


def _inspect_snapshot(
    *,
    artifact_repo: ArtifactRepository,
    store: UriStore,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> SnapshotInspection:
    run_uri = artifact_repo.paths.run_metadata_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    if not artifact_repo.store.exists(uri=run_uri):
        return SnapshotInspection(
            summary={
                "status": "missing",
                "path": artifact_repo.paths.relative_key(run_uri),
                "error": f"missing run metadata snapshot: {run_uri}",
            },
            loaded=None,
        )
    try:
        from ..runs.snapshots import load_run_snapshot

        snapshot = load_run_snapshot(
            artifact_repo=artifact_repo,
            store=store,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
    except (Exception, SystemExit) as exc:
        return SnapshotInspection(
            summary={
                "status": "invalid",
                "path": artifact_repo.paths.relative_key(run_uri),
                "error": str(exc),
            },
            loaded=None,
        )
    return SnapshotInspection(
        summary={
            "status": "valid",
            "path": artifact_repo.paths.relative_key(run_uri),
            "product_config_digest": snapshot.product_config_digest,
            "pipeline_uri": snapshot.pipeline_uri,
            "catalog_uri": snapshot.catalog_uri,
            "error": None,
        },
        loaded=snapshot,
    )


def _marker_summary(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
    snapshot: LoadedRunSnapshot | None,
) -> dict[str, Any]:
    if snapshot is None:
        existing = artifact_repo.list_success_marker_uris(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
        return {
            "expected": None,
            "completed": len(existing),
            "missing": None,
            "missing_sample": [],
            "invalid_sample": [],
            "complete": None,
            "last_progress_at": None,
        }

    dataset = snapshot.dataset(dataset_id)
    progress = summarize_cycle_progress(
        artifact_root_uri=artifact_repo.paths.artifact_root_uri,
        dataset_id=dataset_id,
        cycle=cycle,
        artifact_ids=dataset.workload.artifacts,
        frames=dataset.workload.frames,
        objects=artifact_repo.list_cycle_run_objects(dataset_id=dataset_id, cycle=cycle),
        read_json=artifact_repo.read_json_uri,
        run_id=run_id,
        manifest_present=artifact_repo.public_run_manifest_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
    )
    return {
        "expected": progress.expected_markers,
        "completed": progress.found_markers,
        "missing": progress.missing_markers,
        "missing_sample": list(progress.missing_sample),
        "invalid_sample": list(progress.invalid_marker_sample),
        "complete": progress.complete,
        "last_progress_at": _timestamp_string_or_none(progress.last_progress_at),
    }


def _validation_summary(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    uri = artifact_repo.paths.validation_report_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.validation_report_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return {"status": "missing", "path": path, "errors": 0, "warnings": 0, "error": None}
    try:
        report = artifact_repo.read_validation_report(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        return {"status": "invalid", "path": path, "errors": None, "warnings": None, "error": str(exc)}
    status = report.get("status")
    if status not in {"passed", "failed"}:
        return {
            "status": "invalid",
            "path": path,
            "errors": None,
            "warnings": None,
            "error": f"unexpected validation status: {status!r}",
        }
    errors = report.get("errors")
    warnings = report.get("warnings")
    return {
        "status": status,
        "path": path,
        "errors": len(errors) if isinstance(errors, list) else None,
        "warnings": len(warnings) if isinstance(warnings, list) else None,
        "generated_at": report.get("generated_at"),
        "payload_check_mode": report.get("payload_check_mode"),
        "error": None,
    }


def _publication_summary(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    uri = artifact_repo.paths.publication_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    path = artifact_repo.paths.relative_key(uri)
    if not artifact_repo.publication_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id):
        return {"status": "missing", "path": path, "error": None}
    try:
        marker = artifact_repo.read_publication(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except (Exception, SystemExit) as exc:
        return {"status": "invalid", "path": path, "error": str(exc)}
    return {
        "status": "present",
        "path": path,
        "generated_at": marker.generated_at,
        "revision": marker.revision,
        "manifest_path": marker.manifest_path,
        "error": None,
    }


def _manifest_summary(*, artifact_repo: ArtifactRepository, dataset_id: str, cycle: str, run_id: str) -> dict[str, Any]:
    internal_uri = artifact_repo.paths.run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    public_uri = artifact_repo.paths.public_run_manifest_uri(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    return {
        "internal_run_manifest_path": artifact_repo.paths.relative_key(internal_uri),
        "internal_run_manifest_exists": artifact_repo.run_manifest_exists(dataset_id=dataset_id, cycle=cycle, run_id=run_id),
        "public_run_manifest_path": artifact_repo.paths.relative_key(public_uri),
        "public_run_manifest_exists": artifact_repo.public_run_manifest_exists(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        ),
    }


def _published_manifest_status(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> dict[str, str]:
    return {
        "current": _manifest_status(
            artifact_repo=artifact_repo,
            uri=artifact_repo.paths.cycle_current_manifest_uri(dataset_id=dataset_id, cycle=cycle),
            dataset_id=dataset_id,
            expected_cycle=cycle,
            run_id=run_id,
        ),
        "latest": _manifest_status(
            artifact_repo=artifact_repo,
            uri=artifact_repo.paths.latest_manifest_uri(dataset_id=dataset_id),
            dataset_id=dataset_id,
            expected_cycle=None,
            run_id=run_id,
        ),
    }


def _manifest_status(
    *,
    artifact_repo: ArtifactRepository,
    uri: str,
    dataset_id: str,
    expected_cycle: str | None,
    run_id: str,
) -> str:
    try:
        if not artifact_repo.store.exists(uri=uri):
            return "missing"
        manifest = parse_cycle_manifest(artifact_repo.read_json_uri(uri), uri=uri)
    except (OSError, TypeError, ValueError, SystemExit):
        return "invalid"

    if manifest.dataset_id != dataset_id:
        return "invalid"
    if expected_cycle is not None and manifest.cycle != expected_cycle:
        return "invalid"
    return "matches" if manifest.run_id == run_id else "different"


def _run_state(*, snapshot: Mapping[str, Any], markers: Mapping[str, Any]) -> str:
    if snapshot.get("status") == "missing":
        return "missing_snapshot"
    if snapshot.get("status") == "invalid":
        return "invalid_snapshot"
    if markers.get("complete") is True:
        return "complete"
    return "incomplete"


def _publication_ready(*, markers: Mapping[str, Any], validation: Mapping[str, Any]) -> bool:
    return markers.get("complete") is True and validation.get("status") == "passed"


def _lifecycle_stage(
    *,
    snapshot: Mapping[str, Any],
    markers: Mapping[str, Any],
    validation: Mapping[str, Any],
    publication: Mapping[str, Any],
    published_manifest_status: Mapping[str, Any],
) -> RunLifecycleStage:
    if snapshot.get("status") == "missing":
        return "missing_snapshot"
    if snapshot.get("status") == "invalid":
        return "invalid_snapshot"
    if markers.get("invalid_sample"):
        return "invalid_markers"
    if markers.get("complete") is not True:
        return "pending_frames"
    if validation.get("status") == "missing":
        return "ready_for_validation"
    if validation.get("status") != "passed":
        return "validation_failed"
    if publication.get("status") != "present":
        return "ready_for_publish"
    if any(status != "matches" for status in published_manifest_status.values()):
        return "published_with_manifest_drift"
    return "published"


def _run_diagnostics(
    *,
    snapshot: Mapping[str, Any],
    markers: Mapping[str, Any],
    validation: Mapping[str, Any],
    publication: Mapping[str, Any],
    published_manifest_status: Mapping[str, Any],
) -> list[str]:
    diagnostics: list[str] = []
    if snapshot.get("status") != "valid":
        diagnostics.append(str(snapshot.get("error") or f"snapshot status is {snapshot.get('status')}"))
    if markers.get("complete") is False:
        diagnostics.append(f"missing markers: {markers.get('missing')}")
    if validation.get("status") != "passed":
        diagnostics.append(f"validation status is {validation.get('status')}")
    if publication.get("status") != "present":
        diagnostics.append(f"publication marker status is {publication.get('status')}")
    if publication.get("status") == "present":
        for label in ("current", "latest"):
            match_status = str(published_manifest_status.get(label))
            if match_status != "matches":
                diagnostics.append(f"{label} manifest status for this run is {match_status}")
    return diagnostics


def _timestamp_string_or_none(value: object) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return None
