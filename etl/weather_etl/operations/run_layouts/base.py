"""Shared run-layout data objects."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class RunTarget:
    """One immutable run target for local lifecycle execution."""

    dataset_id: str
    cycle: str
    run_id: str
    snapshot_frames: tuple[str, ...] | None
    plan_frames: tuple[str, ...] | None
    rolling_anchor: datetime | None = None


@dataclass(frozen=True)
class PublishTarget:
    """One persisted run candidate for publication."""

    dataset_id: str
    cycle: str
    run_id: str | None
    rolling_anchor: datetime | None = None
