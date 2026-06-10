from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.artifacts import (
    DEFAULT_CODE_REVISION,
    DEFAULT_IMAGE_IDENTITY,
    DEFAULT_PRODUCT_CONFIG_DIGEST,
    DEFAULT_RUN_ID,
)
from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.grids import small_grid_meta_fixture
from tests.fixtures.pipeline import add_dataset_artifact, minimal_pipeline_config
from tests.fixtures.proc import noop_run
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.environment import EtlEnvironment
from weather_etl.environment.context import ExecutionContext
from weather_etl.operations.run_frame import run_frame, run_frame_job
from weather_etl.processing.artifact import ProcessedArtifact
from weather_etl.sources.prepared_grib import PreparedGribSource
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.state.runs.metadata import RunMetadata, RunSnapshot
from weather_etl.storage.local import LocalFSStore


def test_run_frame_resolves_snapshot_dataset_and_selected_artifacts(
    fake_env: EtlEnvironment,
    loaded_run_snapshot_factory,
) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(artifacts=("tmp_surface", "rh_surface"))

    with (
        patch.object(fake_env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot) as ensure_snapshot,
        patch("weather_etl.operations.run_frame.run_frame_job") as run_frame_job,
    ):
        run_frame(
            env=fake_env,
            dataset_id="gfs",
            cycle="2026021300",
            run_id=f" {DEFAULT_RUN_ID} ",
            frame_id="003",
            source_uri="s3://source/gfs.f003",
            selected_artifacts=("rh_surface",),
        )

    assert ensure_snapshot.call_args.kwargs["dataset_id"] == "gfs"
    assert ensure_snapshot.call_args.kwargs["cycle"] == "2026021300"
    assert ensure_snapshot.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
    assert run_frame_job.call_args.kwargs["ctx"].dataset_id == "gfs"
    assert run_frame_job.call_args.kwargs["dataset"].id == "gfs"
    assert run_frame_job.call_args.kwargs["run_id"] == DEFAULT_RUN_ID
    assert run_frame_job.call_args.kwargs["source_uri"] == "s3://source/gfs.f003"
    assert run_frame_job.call_args.kwargs["artifact_ids"] == ("rh_surface",)
    assert run_frame_job.call_args.kwargs["store"] is fake_env.store
    assert run_frame_job.call_args.kwargs["run_snapshot"] == loaded_snapshot.run_snapshot


def test_run_frame_reads_grid_once_for_all_artifacts(tmp_path: Path) -> None:
    cfg = minimal_pipeline_config()
    rh_config = {
        **minimal_artifact_config(),
        "parameter": "rh",
        "units": "%",
        "encoding": {
            "id": "rh_surface_i16_v1",
            "format": "linear-i16-v1",
            "dtype": "int16",
            "byte_order": "little",
            "scale": 0.01,
            "offset": 0.0,
            "nodata": -32768,
        },
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "GRIB_ELEMENT": "RH",
                },
            }
        ],
    }
    add_dataset_artifact(cfg, dataset_id="gfs", artifact_id="rh_surface", artifact_config=rh_config)
    cfg["datasets"]["gfs"]["workload"]["artifacts"] = ["tmp_surface", "rh_surface"]
    dataset = parse_pipeline_config(cfg).dataset("gfs")

    grib_path = tmp_path / "input.grib2"
    grib_path.write_bytes(b"grib")
    artifacts = ArtifactRepository.for_root(
        store=LocalFSStore(),
        artifact_root_uri=(tmp_path / "out").as_uri(),
    )
    source = PreparedGribSource.grib(
        uri="file:///tmp/input.grib2",
        path=grib_path,
        grid_id="gfs_0p25_global",
    )
    grid = small_grid_meta_fixture()

    def _process_artifact(**kwargs: object) -> ProcessedArtifact:
        artifact = kwargs["artifact"]
        return ProcessedArtifact(
            dtype=artifact.encoding.dtype,
            payload=b"\x00" * 8,
            grid_id=source.grid_id,
            grid=grid,
        )

    with (
        patch("weather_etl.operations.run_frame.acquire_prepared_source", return_value=source),
        patch("weather_etl.operations.run_frame.grid_meta_from_grib", return_value=grid) as grid_meta,
        patch("weather_etl.operations.run_frame.process_artifact", side_effect=_process_artifact) as process,
    ):
        run_frame_job(
            ctx=ExecutionContext(
                dataset_id="gfs",
                artifact_root_uri=artifacts.paths.artifact_root_uri,
                frames=("000",),
            ),
            dataset=dataset,
            cycle="2026041200",
            run_id=DEFAULT_RUN_ID,
            frame_id="000",
            source_uri=None,
            artifact_ids=dataset.workload.artifacts,
            store=artifacts.store,
            artifact_repo=artifacts,
            run=noop_run,
            run_snapshot=RunSnapshot(
                metadata=RunMetadata(
                    code_revision=DEFAULT_CODE_REVISION,
                    image_identity=DEFAULT_IMAGE_IDENTITY,
                    product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
                ),
                pipeline=cfg,
                catalog=catalog_for_dataset(
                    parse_pipeline_config(cfg).dataset("gfs")
                ),
            ),
        )

    for artifact_id in ("tmp_surface", "rh_surface"):
        marker = artifacts.read_artifact_success_marker(
            dataset_id="gfs",
            cycle="2026041200",
            run_id=DEFAULT_RUN_ID,
            frame_id="000",
            artifact_id=artifact_id,
        )
        assert marker.artifact.byte_length == 8
        assert marker.run_id == DEFAULT_RUN_ID
        assert marker.code_revision == DEFAULT_CODE_REVISION
        assert marker.image_identity == DEFAULT_IMAGE_IDENTITY
        assert marker.product_config_digest == DEFAULT_PRODUCT_CONFIG_DIGEST
        assert artifacts.store.exists(
            uri=artifacts.paths.success_marker_uri_parts(
                dataset_id="gfs",
                cycle="2026041200",
                run_id=DEFAULT_RUN_ID,
                artifact_id=artifact_id,
                frame_id="000",
            )
        )

    assert artifacts.store.exists(
        uri=artifacts.paths.run_metadata_uri(
            dataset_id="gfs",
            cycle="2026041200",
            run_id=DEFAULT_RUN_ID,
        )
    )
    assert artifacts.store.exists(
        uri=artifacts.paths.run_pipeline_uri(
            dataset_id="gfs",
            cycle="2026041200",
            run_id=DEFAULT_RUN_ID,
        )
    )
    assert not (tmp_path / "out" / "fields" / "gfs" / "2026041200").exists()
    assert not (tmp_path / "out" / "status" / "gfs" / "2026041200").exists()

    grid_meta.assert_called_once_with(grib_path=grib_path, run=noop_run)
    assert process.call_count == 2
