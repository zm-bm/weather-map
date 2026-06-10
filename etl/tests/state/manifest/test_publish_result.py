from __future__ import annotations

import pytest
from weather_etl.state.manifest.publish import PublishResult


@pytest.mark.parametrize(
    ("result", "outcome", "newly_published"),
    (
        (PublishResult(ready=False, already_published=False), "not_ready", False),
        (PublishResult(ready=False, already_published=True), "not_ready", False),
        (PublishResult(ready=True, already_published=False), "published", True),
        (PublishResult(ready=True, already_published=True), "already_published", False),
    ),
)
def test_publish_result_derives_attempt_outcome(
    result: PublishResult,
    outcome: str,
    newly_published: bool,
) -> None:
    assert result.outcome == outcome
    assert result.newly_published is newly_published
