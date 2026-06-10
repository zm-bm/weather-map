from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from tests.fixtures.artifacts import ArtifactFixture
from tests.fixtures.status_document import manifest_index_summary, status_freshness
from weather_etl.config.product import product_config_digest
from weather_etl.operations.refresh_status import refresh_status

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)


def test_refresh_status_writes_public_status_document(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory()
    env = _Env(artifact_fixture=artifact_fixture, product_config=product_config)
    with (
        patch(
            "weather_etl.state.inspection.status_document.inspect_dataset_freshness",
            return_value=status_freshness(),
        ),
        patch(
            "weather_etl.state.inspection.status_document.summarize_index",
            return_value=manifest_index_summary("valid"),
        ),
    ):
        result = refresh_status(env=env, now=NOW)

    assert result.uri == artifact_fixture.paths.status_uri()
    assert _read_written_status(artifact_fixture) == result.document
    assert result.document["ok"] is True
    assert result.document["product_config_digest"] == product_config_digest(product_config)


def test_refresh_status_writes_failed_document_when_config_load_fails(
    artifact_fixture: ArtifactFixture,
) -> None:
    env = _Env(artifact_fixture=artifact_fixture, load_error=SystemExit("catalog drift"))

    result = refresh_status(env=env, now=NOW, fallback_dataset_ids=("gfs", "icon"))

    assert result.uri == artifact_fixture.paths.status_uri()
    assert result.document["ok"] is False
    assert result.document["product_config_digest"] is None
    assert result.document["config_error"] == "catalog drift"
    assert [dataset["status"] for dataset in result.document["datasets"]] == ["unavailable", "unavailable"]


def test_refresh_status_filters_explicit_dataset_ids(
    artifact_fixture: ArtifactFixture,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(dataset_ids=("gfs", "icon"))
    env = _Env(artifact_fixture=artifact_fixture, product_config=product_config)
    with (
        patch(
            "weather_etl.state.inspection.status_document.inspect_dataset_freshness",
            return_value=status_freshness(),
        ) as inspect,
        patch(
            "weather_etl.state.inspection.status_document.summarize_index",
            return_value=manifest_index_summary("valid"),
        ),
    ):
        result = refresh_status(env=env, dataset_ids=("icon",), now=NOW)

    assert [dataset["dataset_id"] for dataset in result.document["datasets"]] == ["icon"]
    assert inspect.call_args.kwargs["dataset"].id == "icon"


class _Env:
    def __init__(
        self,
        *,
        artifact_fixture: ArtifactFixture,
        product_config=None,
        load_error: BaseException | None = None,
    ) -> None:
        self.artifact_root_uri = artifact_fixture.paths.artifact_root_uri
        self.store = artifact_fixture.store
        self.artifact_repo = artifact_fixture.repository
        self._product_config = product_config
        self._load_error = load_error

    def load_product_config(self):
        if self._load_error is not None:
            raise self._load_error
        if self._product_config is None:
            pytest.fail("product config was not configured")
        return self._product_config


def _read_written_status(artifact_fixture: ArtifactFixture) -> dict:
    return json.loads(artifact_fixture.store.read_bytes(uri=artifact_fixture.paths.status_uri()).decode("utf-8"))
