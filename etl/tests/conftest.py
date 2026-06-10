from __future__ import annotations

from pathlib import Path

import pytest
from weather_etl.environment import EtlEnvironment

from tests.fixtures.artifacts import ArtifactFixture
from tests.fixtures.artifacts import artifact_fixture as build_artifact_fixture
from tests.fixtures.paths import repo_root_from
from tests.fixtures.pipeline import (
    loaded_product_config as build_loaded_product_config,
)
from tests.fixtures.pipeline import (
    loaded_run_snapshot as build_loaded_run_snapshot,
)
from tests.fixtures.pipeline import (
    pipeline_config as build_pipeline_config,
)
from tests.fixtures.pipeline import (
    raw_pipeline_config as build_raw_pipeline_config,
)


class _FakeStore:
    pass


@pytest.fixture
def repo_root() -> Path:
    return repo_root_from(__file__)


@pytest.fixture
def fake_env() -> EtlEnvironment:
    return EtlEnvironment(
        artifact_root_uri="s3://artifacts",
        pipeline_uri="s3://config/pipeline.json",
        catalog_uri="s3://config/catalog.json",
        store=_FakeStore(),
    )


@pytest.fixture
def artifact_fixture(tmp_path: Path) -> ArtifactFixture:
    return build_artifact_fixture(tmp_path)


@pytest.fixture
def raw_pipeline_config_factory():
    return build_raw_pipeline_config


@pytest.fixture
def pipeline_config_factory():
    return build_pipeline_config


@pytest.fixture
def loaded_product_config_factory():
    return build_loaded_product_config


@pytest.fixture
def loaded_run_snapshot_factory():
    return build_loaded_run_snapshot
