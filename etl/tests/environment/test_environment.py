from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from weather_etl.environment import EtlEnvironment
from weather_etl.storage.uris import file_uri


def test_etl_environment_normalizes_local_paths(tmp_path: Path, fake_env: EtlEnvironment) -> None:
    env = EtlEnvironment(
        artifact_root_uri=str(tmp_path / "artifacts"),
        pipeline_uri=str(tmp_path / "pipeline config.json"),
        catalog_uri="file://localhost" + (tmp_path / "catalog.json").as_posix(),
        store=fake_env.store,
    )

    assert env.artifact_root_uri == file_uri(tmp_path / "artifacts")
    assert env.pipeline_uri == file_uri(tmp_path / "pipeline config.json")
    assert env.catalog_uri == file_uri(tmp_path / "catalog.json")


def test_etl_environment_builds_repository_and_resolves_dataset_runtime(
    fake_env: EtlEnvironment,
    loaded_product_config_factory,
) -> None:
    product_config = loaded_product_config_factory(frame_start=0, frame_end=1)

    with patch("weather_etl.environment.load_product_config", return_value=product_config) as load:
        runtime = fake_env.resolve_dataset_runtime("gfs")

    assert fake_env.artifact_repo.paths.artifact_root_uri == "s3://artifacts"
    assert runtime.product_config is product_config
    assert runtime.dataset.id == "gfs"
    assert runtime.execution_context.dataset_id == "gfs"
    assert runtime.execution_context.artifact_root_uri == "s3://artifacts"
    assert runtime.execution_context.frames == ("000", "001")
    assert load.call_args.kwargs == {
        "pipeline_uri": "s3://config/pipeline.json",
        "catalog_uri": "s3://config/catalog.json",
        "store": fake_env.store,
    }
