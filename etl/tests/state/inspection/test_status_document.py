from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

from weather_etl.config.product import product_config_digest
from weather_etl.state.inspection.status_document import (
    STATUS_DOCUMENT_SCHEMA,
    STATUS_DOCUMENT_SCHEMA_VERSION,
    build_status_document,
    failed_status_document,
)

from tests.fixtures.artifacts import ArtifactFixture
from tests.fixtures.status_document import (
    manifest_index_summary,
    status_document_options,
    status_freshness,
    status_progress,
)

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)


def test_status_document_reports_healthy_datasets_and_manifest_index(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(dataset_ids=("gfs", "icon"))
    with (
        patch(
            "weather_etl.state.inspection.status_document.inspect_dataset_freshness",
            return_value=status_freshness("fresh"),
        ),
        patch(
            "weather_etl.state.inspection.status_document.summarize_index",
            return_value=manifest_index_summary("valid"),
        ),
    ):
        document = _build_document(artifact_fixture, product_config=product_config)

    assert document["schema"] == STATUS_DOCUMENT_SCHEMA
    assert document["schema_version"] == STATUS_DOCUMENT_SCHEMA_VERSION
    assert document["generated_at"] == "2026-05-11T18:30:00Z"
    assert document["ok"] is True
    assert document["product_config_digest"] == product_config_digest(product_config)
    assert document["dataset_count"] == 2
    assert document["bad_dataset_count"] == 0
    assert document["inspection_failure_count"] == 0
    assert [dataset["dataset_id"] for dataset in document["datasets"]] == ["gfs", "icon"]
    assert document["datasets"][0]["lifecycle_stage"] == "published"
    assert document["manifest_index"]["valid"] is True


def test_status_document_reports_bad_dataset_state(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory()
    with (
        patch(
            "weather_etl.state.inspection.status_document.inspect_dataset_freshness",
            return_value=status_freshness("stale"),
        ),
        patch(
            "weather_etl.state.inspection.status_document.summarize_index",
            return_value=manifest_index_summary("valid"),
        ),
    ):
        document = _build_document(artifact_fixture, product_config=product_config)

    assert document["ok"] is False
    assert document["bad_dataset_count"] == 1
    assert document["datasets"][0]["status"] == "stale"
    assert document["datasets"][0]["bad_state"] is True


def test_status_document_serializes_progress_and_lifecycle_stage(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory()
    with (
        patch(
            "weather_etl.state.inspection.status_document.inspect_dataset_freshness",
            return_value=status_freshness("building", progress=status_progress()),
        ),
        patch(
            "weather_etl.state.inspection.status_document.summarize_index",
            return_value=manifest_index_summary("valid"),
        ),
    ):
        document = _build_document(artifact_fixture, product_config=product_config)

    dataset = document["datasets"][0]
    assert document["ok"] is True
    assert dataset["status"] == "building"
    assert dataset["lifecycle_stage"] == "pending_frames"
    assert dataset["progress"]["cycle"] == "2026051112"
    assert dataset["progress"]["missing_sample"] == ["tmp_surface/000"]
    assert dataset["publish_lag"] == {"grace_hours": 3.5, "source": "test"}


def test_status_document_reports_bad_manifest_index(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory()
    with (
        patch(
            "weather_etl.state.inspection.status_document.inspect_dataset_freshness",
            return_value=status_freshness("fresh"),
        ),
        patch(
            "weather_etl.state.inspection.status_document.summarize_index",
            return_value=manifest_index_summary("stale"),
        ),
    ):
        document = _build_document(artifact_fixture, product_config=product_config)

    assert document["ok"] is False
    assert document["manifest_index"]["status"] == "stale"
    assert document["manifest_index"]["valid"] is False


def test_failed_status_document_reports_config_error_and_unavailable_datasets(
    artifact_fixture: ArtifactFixture,
) -> None:
    document = failed_status_document(
        store=artifact_fixture.store,
        artifact_root_uri=artifact_fixture.paths.artifact_root_uri,
        dataset_ids=None,
        fallback_dataset_ids=("gfs", "icon"),
        options=status_document_options(),
        now=NOW,
        config_error="catalog drift",
    )

    assert document["ok"] is False
    assert document["product_config_digest"] is None
    assert document["config_error"] == "catalog drift"
    assert document["inspection_failure_count"] == 2
    assert [dataset["status"] for dataset in document["datasets"]] == ["unavailable", "unavailable"]
    assert document["manifest_index"]["status"] == "missing"
    assert document["manifest_index"]["valid"] is False


def _build_document(artifact_fixture: ArtifactFixture, *, product_config, dataset_ids=None):
    return build_status_document(
        store=artifact_fixture.store,
        artifact_root_uri=artifact_fixture.paths.artifact_root_uri,
        product_config=product_config,
        dataset_ids=dataset_ids,
        fallback_dataset_ids=("gfs", "icon"),
        options=status_document_options(),
        now=NOW,
    )
