from __future__ import annotations

from weather_etl.sources.submission import SourceSubmissionOutcome, SourceSubmissionResult


def test_source_submission_result_scoped_counts() -> None:
    result = SourceSubmissionResult.from_outcomes(
        SourceSubmissionOutcome(status="pending", scope="cycle", dataset_id="icon", cycle="2026051112"),
        SourceSubmissionOutcome(
            status="pending",
            scope="frame",
            dataset_id="icon",
            cycle="2026051112",
            frame_id="001",
        ),
        SourceSubmissionOutcome(status="blocked", scope="cycle", dataset_id="icon", cycle="2026051106"),
        cycles=2,
    )

    assert result.pending == 2
    assert result.count("pending", scope="cycle") == 1
    assert result.pending_frames == 1
    assert result.blocked == 1
    assert result.count("blocked", scope="cycle") == 1
    assert result.skipped_cycles == 2


def test_source_submission_result_combines_outcomes_in_order() -> None:
    first = SourceSubmissionOutcome(
        status="submitted",
        scope="frame",
        dataset_id="gfs",
        cycle="2026021300",
        frame_id="003",
    )
    second = SourceSubmissionOutcome(
        status="skipped",
        scope="object",
        dataset_id="gfs",
        source_key="gfs.20260213/00/atmos/not-a-match.grib2",
    )
    third = SourceSubmissionOutcome(
        status="pending",
        scope="cycle",
        dataset_id="icon",
        cycle="2026051112",
    )

    result = SourceSubmissionResult.combine(
        (
            SourceSubmissionResult.from_outcomes(first, second, cycles=1),
            SourceSubmissionResult.from_outcomes(third, cycles=2),
        )
    )

    assert result.outcomes == (first, second, third)
    assert result.cycles == 3
    assert result.submitted == 1
    assert result.skipped == 1
    assert result.count("pending", scope="cycle") == 1
