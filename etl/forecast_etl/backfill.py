"""Backfill safety checks for forecast cycle submission."""

from __future__ import annotations

from dataclasses import dataclass

from .artifacts.repository import ArtifactRepository
from .cycles import parse_cycle
from .manifest.pointers import LATEST_POINTER_SCHEMA, parse_manifest_pointer


@dataclass(frozen=True)
class BackfillCheckResult:
    """Result of comparing a requested cycle with the current latest alias."""

    model_id: str
    cycle: str
    latest_status: str
    latest_cycle: str | None
    backfill_required: bool
    backfill_allowed: bool
    ok: bool
    message: str

    def key_values(self) -> tuple[tuple[str, str], ...]:
        return (
            ("model", self.model_id),
            ("cycle", self.cycle),
            ("latest_status", self.latest_status),
            ("latest_cycle", self.latest_cycle or ""),
            ("backfill_required", _bool(self.backfill_required)),
            ("backfill_allowed", _bool(self.backfill_allowed)),
            ("ok", _bool(self.ok)),
            ("message", self.message),
        )


def check_backfill_safety(
    *,
    artifact_repo: ArtifactRepository,
    model_id: str,
    cycle: str,
    allow_backfill: bool = False,
) -> BackfillCheckResult:
    """Return whether a requested cycle may be submitted."""

    parse_cycle(cycle)
    latest_uri = artifact_repo.paths.manifest_latest_uri(model_id=model_id)

    try:
        latest_exists = artifact_repo.latest_manifest_exists(model_id=model_id)
    except Exception as exc:
        return _invalid_latest(model_id=model_id, cycle=cycle, latest_uri=latest_uri, error=exc)

    if not latest_exists:
        return BackfillCheckResult(
            model_id=model_id,
            cycle=cycle,
            latest_status="missing",
            latest_cycle=None,
            backfill_required=False,
            backfill_allowed=allow_backfill,
            ok=True,
            message="No latest manifest exists; allowing bootstrap submit.",
        )

    try:
        latest = artifact_repo.read_latest_pointer(model_id=model_id)
    except FileNotFoundError:
        return BackfillCheckResult(
            model_id=model_id,
            cycle=cycle,
            latest_status="missing",
            latest_cycle=None,
            backfill_required=False,
            backfill_allowed=allow_backfill,
            ok=True,
            message="Latest manifest disappeared during check; allowing bootstrap submit.",
        )
    except Exception as exc:
        return _invalid_latest(model_id=model_id, cycle=cycle, latest_uri=latest_uri, error=exc)

    try:
        pointer = parse_manifest_pointer(latest, expected_schema=LATEST_POINTER_SCHEMA, uri=latest_uri)
    except (Exception, SystemExit) as exc:
        return BackfillCheckResult(
            model_id=model_id,
            cycle=cycle,
            latest_status="invalid",
            latest_cycle=None,
            backfill_required=False,
            backfill_allowed=allow_backfill,
            ok=False,
            message=f"Latest manifest pointer is invalid: {exc}",
        )

    if cycle < pointer.cycle:
        message = f"Requested cycle {cycle} is older than latest {pointer.cycle}."
        return BackfillCheckResult(
            model_id=model_id,
            cycle=cycle,
            latest_status="valid",
            latest_cycle=pointer.cycle,
            backfill_required=True,
            backfill_allowed=allow_backfill,
            ok=allow_backfill,
            message=message if allow_backfill else f"{message} Pass --backfill to submit intentionally.",
        )

    return BackfillCheckResult(
        model_id=model_id,
        cycle=cycle,
        latest_status="valid",
        latest_cycle=pointer.cycle,
        backfill_required=False,
        backfill_allowed=allow_backfill,
        ok=True,
        message=f"Requested cycle {cycle} is current or newer than latest {pointer.cycle}.",
    )


def _invalid_latest(*, model_id: str, cycle: str, latest_uri: str, error: Exception) -> BackfillCheckResult:
    return BackfillCheckResult(
        model_id=model_id,
        cycle=cycle,
        latest_status="invalid",
        latest_cycle=None,
        backfill_required=False,
        backfill_allowed=False,
        ok=False,
        message=f"Unable to read latest manifest {latest_uri}: {type(error).__name__}: {error}",
    )


def _bool(value: bool) -> str:
    return "true" if value else "false"
