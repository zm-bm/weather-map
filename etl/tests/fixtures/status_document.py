from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

from weather_etl.state.inspection.freshness import PublishLagEstimate, PublishLagPolicy
from weather_etl.state.inspection.status_document import StatusDocumentOptions

from .artifacts import DEFAULT_RUN_ID


def status_freshness(status: str = "fresh", *, progress=None) -> SimpleNamespace:
    return SimpleNamespace(
        status=status,
        reason=f"{status} reason",
        expected_cycle="2026051112",
        expected_cycle_deadline=datetime(2026, 5, 11, 15, 30, tzinfo=timezone.utc),
        latest_observed_cycle="2026051112",
        latest_published_cycle="2026051112",
        latest_published_generated_at=datetime(2026, 5, 11, 14, 0, tzinfo=timezone.utc),
        progress=progress,
        publish_lag=PublishLagEstimate(hours=3.5, source="test"),
        lifecycle_stage="pending_frames" if progress is not None else "published",
        lifecycle_cycle="2026051112",
        lifecycle_run_id=DEFAULT_RUN_ID,
    )


def status_progress() -> SimpleNamespace:
    return SimpleNamespace(
        cycle="2026051112",
        run_id=DEFAULT_RUN_ID,
        run_count=1,
        publication_present=False,
        manifest_present=False,
        expected_markers=2,
        found_markers=1,
        missing_markers=1,
        last_progress_at=datetime(2026, 5, 11, 18, 20, tzinfo=timezone.utc),
        missing_sample=("tmp_surface/000",),
        invalid_marker_sample=(),
    )


def manifest_index_summary(status: str = "valid") -> dict:
    return {
        "schema": "weather-map.manifest-index-summary",
        "schema_version": 2,
        "path": "manifests/index.json",
        "status": status,
        "generated_at": "2026-05-11T18:00:00Z",
        "dataset_count": 1,
        "latest_dataset_count": 1 if status == "valid" else 0,
        "diagnostics": [] if status == "valid" else ["stale index"],
    }


def status_document_options() -> StatusDocumentOptions:
    return StatusDocumentOptions(
        history_cycle_count=4,
        status_cycle_count=4,
        publish_lag_policy=PublishLagPolicy(
            fallback_hours=9.0,
            cushion_hours=1.0,
            min_hours=3.0,
            max_hours=12.0,
        ),
        recent_progress_hours=2.0,
    )
