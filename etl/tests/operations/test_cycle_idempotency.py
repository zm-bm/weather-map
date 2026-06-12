from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.grids import small_grid_meta_fixture
from tests.fixtures.manifests import write_latest_manifest
from tests.fixtures.pipeline import loaded_run_snapshot, minimal_pipeline_config
from tests.fixtures.proc import noop_run
from tests.fixtures.publish import publish_fixture
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.config.sources import ICON_DWD_SOURCE_TYPE
from weather_etl.environment import EtlEnvironment
from weather_etl.environment.context import ExecutionContext
from weather_etl.operations.run_frame import run_frame_job
from weather_etl.operations.submit_gfs_source import GfsSourceObject, submit_gfs_source_object
from weather_etl.operations.submit_icon_ready import submit_ready_icon_cycles
from weather_etl.processing.artifact import ProcessedArtifact
from weather_etl.sources.prepared_grib import PreparedGribSource
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.state.manifest.index import read_index_latest_revision
from weather_etl.state.manifest.schema import parse_cycle_manifest
from weather_etl.state.runs.snapshots import LoadedRunSnapshot
from weather_etl.state.runs.validation import validate_run
from weather_etl.storage.local import LocalFSStore


def test_frame_rerun_keeps_success_marker_valid(tmp_path: Path, loaded_run_snapshot_factory) -> None:
    loaded_snapshot = loaded_run_snapshot_factory(cycle="2026041200")
    dataset = loaded_snapshot.dataset("gfs")
    artifacts = ArtifactRepository.for_root(
        store=LocalFSStore(),
        artifact_root_uri=(tmp_path / "out").as_uri(),
    )
    source_path = tmp_path / "input.grib2"
    source_path.write_bytes(b"grib")
    source = PreparedGribSource.grib(
        uri="file:///tmp/input.grib2",
        path=source_path,
        grid_id="gfs_0p25_global",
    )
    grid = small_grid_meta_fixture()
    processed = ProcessedArtifact(
        dtype="int16",
        payload=b"\x00" * 8,
        grid_id=source.grid_id,
        grid=grid,
    )

    with (
        patch("weather_etl.operations.run_frame.acquire_prepared_source", return_value=source),
        patch("weather_etl.operations.run_frame.grid_meta_from_grib", return_value=grid),
        patch("weather_etl.operations.run_frame.process_artifact", return_value=processed),
    ):
        for _ in range(2):
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
                artifact_ids=("tmp_surface",),
                store=artifacts.store,
                artifact_repo=artifacts,
                run=noop_run,
                run_snapshot=loaded_snapshot.run_snapshot,
            )

    marker = artifacts.read_artifact_success_marker(
        dataset_id="gfs",
        cycle="2026041200",
        run_id=DEFAULT_RUN_ID,
        frame_id="000",
        artifact_id="tmp_surface",
    )
    assert marker.artifact.byte_length == 8

    validation = validate_run(
        artifact_repo=artifacts,
        dataset=dataset,
        cycle="2026041200",
        run_id=DEFAULT_RUN_ID,
        snapshot=loaded_snapshot,
    )
    assert validation.passed
    assert validation.errors == ()


def test_validation_rerun_is_stable() -> None:
    with publish_fixture(prefix="weather-map-validate-idempotent-", frames=("000",)) as fx:
        dataset = _dataset()
        snapshot = _snapshot(cycle=fx.cycle, run_id=fx.run_id)
        fx.write_scalar_marker()

        first = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=snapshot,
        )
        second = validate_run(
            artifact_repo=fx.artifacts,
            dataset=dataset,
            cycle=fx.cycle,
            run_id=fx.run_id,
            snapshot=snapshot,
        )

        assert first.passed
        assert second.passed
        assert first.report_uri == second.report_uri
        for field in ("schema", "schema_version", "dataset_id", "cycle", "run_id", "status", "product_config_digest"):
            assert second.report[field] == first.report[field]
        assert second.report["expected"] == first.report["expected"]
        assert second.report["observed"] == first.report["observed"]
        assert second.report["errors"] == []
        assert second.report["warnings"] == []


def test_republish_refreshes_latest_manifest() -> None:
    with publish_fixture(prefix="weather-map-publish-refresh-") as fx:
        scalar_artifacts = ("tmp_surface",)
        artifacts_cfg = _tmp_artifacts_cfg()

        fx.write_scalar_marker(
            artifact_id="tmp_surface",
            artifact_config=artifacts_cfg["tmp_surface"],
        )

        result_first = fx.publish(
            artifact_ids=scalar_artifacts,
            artifacts_cfg=artifacts_cfg,
        )
        assert result_first.ready
        initial_latest = fx.latest_manifest()

        stale_manifest = json.loads(json.dumps(initial_latest))
        stale_manifest["run"].update(
            {
                "cycle": "2026041000",
                "payload_root": f"runs/gfs/2026041000/{fx.run_id}/payloads",
                "generated_at": "2026-04-10T00:00:00+00:00",
                "revision": "stale",
            }
        )
        write_latest_manifest(fx.artifacts, dataset_id="gfs", manifest=stale_manifest)

        result_second = fx.publish(
            artifact_ids=scalar_artifacts,
            artifacts_cfg=artifacts_cfg,
        )

        assert result_second.ready
        assert result_second.already_published
        assert fx.latest_manifest() == initial_latest


def test_publish_rerun_repairs_public_manifests_without_markers() -> None:
    with publish_fixture(prefix="weather-map-publish-repair-existing-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)

        result_first = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            run_id=fx.run_id,
        )
        assert result_first.ready
        original_manifest = fx.cycle_manifest()

        fx.store.delete_uri(
            uri=fx.ap.public_run_manifest_uri(
                dataset_id=fx.dataset_id,
                cycle=fx.cycle,
                run_id=fx.run_id,
            )
        )
        fx.store.delete_uri(uri=fx.ap.cycle_current_manifest_uri(dataset_id=fx.dataset_id, cycle=fx.cycle))
        fx.store.delete_uri(uri=fx.ap.latest_manifest_uri(dataset_id=fx.dataset_id))
        fx.store.delete_uri(uri=fx.marker_uri(artifact_id))

        result_second = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            run_id=fx.run_id,
            auto_validate=False,
        )

        assert result_second.ready
        assert result_second.already_published
        assert fx.cycle_manifest() == original_manifest
        assert fx.current_manifest() == original_manifest
        assert fx.latest_manifest() == original_manifest


def test_publish_rerun_repairs_missing_manifest_index() -> None:
    with publish_fixture(prefix="weather-map-publish-refresh-decision-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        product_config = fx.product_config_for(artifact_ids=(artifact_id,), artifacts_cfg={artifact_id: artifact_cfg})
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)

        result = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            product_config=product_config,
        )
        assert result.ready
        fx.store.delete_uri(uri=fx.ap.manifest_index_uri())

        result_with_index = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            product_config=product_config,
        )
        assert result_with_index.ready
        assert result_with_index.already_published
        assert fx.artifacts.manifest_index_exists()

        with patch("weather_etl.state.manifest.public_view.publish_index") as publish_index:
            result_again = fx.publish(
                artifact_ids=(artifact_id,),
                artifacts_cfg={artifact_id: artifact_cfg},
                product_config=product_config,
            )

        assert result_again.ready
        assert result_again.already_published
        publish_index.assert_not_called()


def test_publish_rerun_repairs_stale_public_manifests_and_index_without_markers() -> None:
    with publish_fixture(prefix="weather-map-publish-repair-stale-public-state-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        product_config = fx.product_config_for(artifact_ids=(artifact_id,), artifacts_cfg={artifact_id: artifact_cfg})
        fx.write_scalar_marker(artifact_id=artifact_id, artifact_config=artifact_cfg)

        first = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            product_config=product_config,
        )
        assert first.ready
        original_manifest = fx.cycle_manifest()
        original_revision = original_manifest["run"]["revision"]
        assert read_index_latest_revision(artifact_repo=fx.artifacts, dataset_id=fx.dataset_id) == original_revision

        stale_manifest = json.loads(json.dumps(original_manifest))
        stale_manifest["run"]["revision"] = "stale-revision"
        parsed_stale_manifest = parse_cycle_manifest(stale_manifest)
        fx.artifacts.write_cycle_current_manifest(
            dataset_id=fx.dataset_id,
            cycle=fx.cycle,
            manifest=parsed_stale_manifest,
        )
        fx.artifacts.write_latest_manifest(dataset_id=fx.dataset_id, manifest=parsed_stale_manifest)

        stale_index = fx.artifacts.read_manifest_index()
        stale_index["datasets"][fx.dataset_id]["latest"]["run"]["revision"] = "stale-revision"
        fx.artifacts.write_manifest_index(manifest=stale_index)
        fx.store.delete_uri(uri=fx.marker_uri(artifact_id))

        second = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            product_config=product_config,
            auto_validate=False,
        )

        assert second.ready
        assert second.already_published
        assert fx.current_manifest() == original_manifest
        assert fx.latest_manifest() == original_manifest
        assert read_index_latest_revision(artifact_repo=fx.artifacts, dataset_id=fx.dataset_id) == original_revision


def test_gfs_source_resubmission_skips_completed_frame(loaded_run_snapshot_factory) -> None:
    with publish_fixture(prefix="weather-map-gfs-source-complete-marker-", cycle="2026021300", frames=("003",)) as fx:
        env = _env(fx)
        loaded_snapshot = loaded_run_snapshot_factory(
            cycle=fx.cycle,
            frame_start=3,
            frame_end=3,
            artifact_root_uri=fx.artifact_root_uri,
        )
        fx.write_scalar_marker(frame_id="003")
        batch = FakeBatchClient()
        ddb = FakeDynamoClient()

        with (
            patch("weather_etl.operations.submit_gfs_source.generate_run_id", return_value=fx.run_id),
            patch.object(env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot),
        ):
            result = submit_gfs_source_object(
                batch=batch,
                ddb=ddb,
                queue="weather-etl",
                job_definition="weather-etl-worker:1",
                run_coordinator_table="run-coordinator",
                frame_claim_table="frame-claims",
                env=env,
                source_object=GfsSourceObject(
                    bucket="noaa-gfs-bdp-pds",
                    key="gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
                ),
            )

    assert result.submitted == 0
    assert result.completed == 1
    assert result.outcomes[0].status == "completed"
    assert result.outcomes[0].scope == "frame"
    assert batch.submissions == []
    assert ddb.items[f"gfs#2026021300#{fx.run_id}#003"]["state"] == "complete"


def test_icon_source_resubmission_skips_completed_frame(loaded_run_snapshot_factory) -> None:
    cycle = "2026051112"
    with publish_fixture(
        prefix="weather-map-icon-ready-complete-marker-",
        dataset_id="icon",
        dataset_label="ICON",
        cycle=cycle,
        frames=("001",),
    ) as fx:
        env = _env(fx)
        loaded_snapshot = loaded_run_snapshot_factory(
            dataset_id="icon",
            source_types={"icon": ICON_DWD_SOURCE_TYPE},
            frame_start=1,
            frame_end=1,
            cycle=cycle,
            artifact_root_uri=fx.artifact_root_uri,
        )
        fx.write_scalar_marker(frame_id="001")
        batch = FakeBatchClient()
        ddb = FakeDynamoClient()
        now = datetime(2026, 5, 11, 12, tzinfo=timezone.utc)

        with (
            patch("weather_etl.operations.submit_icon_ready.generate_run_id", return_value=fx.run_id),
            patch.object(env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.operations.submit_icon_ready._url_ready", return_value=True),
        ):
            result = submit_ready_icon_cycles(
                batch=batch,
                ddb=ddb,
                queue="weather-etl",
                job_definition="weather-etl-worker-icon:1",
                frame_claim_table="frame-claims",
                run_coordinator_table="run-coordinator",
                env=env,
                cycles=(cycle,),
                sentinel_params=("t_2m",),
                min_bytes=1,
                now=now,
            )

    assert result.submitted == 0
    assert result.completed == 1
    assert any(outcome.status == "completed" and outcome.scope == "frame" for outcome in result.outcomes)
    assert batch.submissions == []
    assert ddb.items[f"icon#{cycle}#{fx.run_id}#001"]["state"] == "complete"


def test_source_resubmission_skips_active_frame_claim(loaded_run_snapshot_factory) -> None:
    with publish_fixture(prefix="weather-map-gfs-source-claimed-", cycle="2026021300", frames=("003",)) as fx:
        env = _env(fx)
        loaded_snapshot = loaded_run_snapshot_factory(
            cycle=fx.cycle,
            frame_start=3,
            frame_end=3,
            artifact_root_uri=fx.artifact_root_uri,
        )
        batch = FakeBatchClient()
        ddb = FakeDynamoClient()
        ddb.items[f"gfs#2026021300#{fx.run_id}#003"] = {
            "dataset_id": "gfs",
            "cycle": "2026021300",
            "run_id": fx.run_id,
            "frame_id": "003",
            "state": "claimed",
            "attempt": 1,
            "expires_at_epoch": 2_000_000_000,
        }

        with (
            patch("weather_etl.operations.submit_gfs_source.generate_run_id", return_value=fx.run_id),
            patch.object(env, "ensure_or_load_run_snapshot", return_value=loaded_snapshot),
        ):
            result = submit_gfs_source_object(
                batch=batch,
                ddb=ddb,
                queue="weather-etl",
                job_definition="weather-etl-worker:1",
                run_coordinator_table="run-coordinator",
                frame_claim_table="frame-claims",
                env=env,
                source_object=GfsSourceObject(
                    bucket="noaa-gfs-bdp-pds",
                    key="gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
                ),
            )

    assert result.submitted == 0
    assert result.claimed == 1
    assert result.outcomes[0].status == "claimed"
    assert result.outcomes[0].reason == "frame_state:claimed"
    assert batch.submissions == []


def _dataset(*, frame_end: int = 0):
    cfg = minimal_pipeline_config()
    cfg["datasets"]["gfs"]["workload"]["frame_end"] = frame_end
    return parse_pipeline_config(cfg).dataset("gfs")


def _snapshot(*, cycle: str, run_id: str, frame_end: int = 0) -> LoadedRunSnapshot:
    return loaded_run_snapshot(
        cycle=cycle,
        run_id=run_id,
        frame_end=frame_end,
        artifact_root_uri="file:///artifacts",
    )


def _tmp_artifacts_cfg() -> dict[str, dict]:
    return {"tmp_surface": minimal_artifact_config()}


def _env(fx) -> EtlEnvironment:
    return EtlEnvironment(
        artifact_root_uri=fx.artifact_root_uri,
        pipeline_uri="file:///config/pipeline.json",
        catalog_uri="file:///config/catalog.json",
        store=fx.store,
    )
