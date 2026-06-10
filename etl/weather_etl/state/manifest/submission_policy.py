"""Application policy for deciding whether a dataset cycle may be submitted."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ...core.cycles import split_cycle
from ..artifacts.repository import ArtifactRepository


@dataclass(frozen=True)
class CycleSubmissionDecision:
    """Result of comparing a requested cycle with the latest public manifest."""

    dataset_id: str
    cycle: str
    latest_status: Literal["missing", "invalid", "valid"]
    latest_cycle: str | None
    backfill_required: bool
    force_backfill: bool
    allowed: bool
    message: str


def check_cycle_submission_policy(
    *,
    artifact_repo: ArtifactRepository,
    dataset_id: str,
    cycle: str,
    force_backfill: bool = False,
) -> CycleSubmissionDecision:
    """Return whether a requested cycle may be submitted."""

    cycle_date, cycle_hour = split_cycle(cycle)
    cycle = f"{cycle_date}{cycle_hour}"
    latest_uri = artifact_repo.paths.latest_manifest_uri(dataset_id=dataset_id)

    try:
        latest_manifest = artifact_repo.read_latest_manifest(dataset_id=dataset_id)
    except FileNotFoundError:
        return CycleSubmissionDecision(
            dataset_id=dataset_id,
            cycle=cycle,
            latest_status="missing",
            latest_cycle=None,
            backfill_required=False,
            force_backfill=force_backfill,
            allowed=True,
            message="No latest manifest exists; allowing bootstrap submit.",
        )
    except (ValueError, SystemExit) as exc:
        return _invalid_latest(
            dataset_id=dataset_id,
            cycle=cycle,
            latest_uri=latest_uri,
            force_backfill=force_backfill,
            error=exc,
        )

    if latest_manifest.dataset_id != dataset_id:
        return CycleSubmissionDecision(
            dataset_id=dataset_id,
            cycle=cycle,
            latest_status="invalid",
            latest_cycle=None,
            backfill_required=False,
            force_backfill=force_backfill,
            allowed=False,
            message=(
                f"Latest manifest dataset_id mismatch: expected={dataset_id!r} found={latest_manifest.dataset_id!r}"
            ),
        )

    if cycle < latest_manifest.cycle:
        message = f"Requested cycle {cycle} is older than latest {latest_manifest.cycle}."
        return CycleSubmissionDecision(
            dataset_id=dataset_id,
            cycle=cycle,
            latest_status="valid",
            latest_cycle=latest_manifest.cycle,
            backfill_required=True,
            force_backfill=force_backfill,
            allowed=force_backfill,
            message=message if force_backfill else f"{message} Pass --force-backfill to submit intentionally.",
        )

    return CycleSubmissionDecision(
        dataset_id=dataset_id,
        cycle=cycle,
        latest_status="valid",
        latest_cycle=latest_manifest.cycle,
        backfill_required=False,
        force_backfill=force_backfill,
        allowed=True,
        message=f"Requested cycle {cycle} is current or newer than latest {latest_manifest.cycle}.",
    )


def _invalid_latest(
    *,
    dataset_id: str,
    cycle: str,
    latest_uri: str,
    force_backfill: bool,
    error: BaseException,
) -> CycleSubmissionDecision:
    return CycleSubmissionDecision(
        dataset_id=dataset_id,
        cycle=cycle,
        latest_status="invalid",
        latest_cycle=None,
        backfill_required=False,
        force_backfill=force_backfill,
        allowed=False,
        message=f"Unable to read latest manifest {latest_uri}: {type(error).__name__}: {error}",
    )
