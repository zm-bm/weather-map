from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from tests.fixtures.artifact_configs import wind_artifact_config
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.pipeline import add_dataset_artifact, minimal_pipeline_config
from weather_etl.adapters.aws import gfs_ingest_lambda
from weather_etl.sources.submission import SourceSubmissionOutcome, SourceSubmissionResult


def _sns_event(key: str) -> dict:
    return _sns_event_for_keys((key,))


def _sns_event_for_keys(keys: tuple[str, ...]) -> dict:
    return {
        "Records": [
            {
                "EventSource": "aws:sns",
                "Sns": {
                    "Message": json.dumps(
                        {
                            "Records": [
                                {
                                    "s3": {
                                        "bucket": {"name": "noaa-gfs-bdp-pds"},
                                        "object": {"key": key},
                                    }
                                }
                                for key in keys
                            ]
                        }
                    )
                },
            }
        ]
    }


class TestAwsGfsIngest:
    @pytest.fixture(autouse=True)
    def setup_handler(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self.batch = FakeBatchClient()
        self.ddb = FakeDynamoClient()
        monkeypatch.setattr(
            "weather_etl.operations.submit_gfs_source.generate_run_id",
            lambda *, now=None: DEFAULT_RUN_ID,
        )
        monkeypatch.setenv("ARTIFACT_ROOT_URI", f"file://{tmp_path.as_posix()}")
        monkeypatch.setenv("BATCH_JOB_QUEUE", "weather-etl")
        monkeypatch.setenv("BATCH_JOB_DEFINITION", "weather-etl-worker:1")
        monkeypatch.setenv("FRAME_CLAIM_TABLE", "frame-claims")
        monkeypatch.setenv("RUN_COORDINATOR_TABLE", "run-coordinator")

    def test_handler_delegates_supported_s3_objects_to_command(self) -> None:
        with (
            patch(
                "weather_etl.adapters.aws.gfs_ingest_lambda.submit_gfs_source_object",
                side_effect=(
                    SourceSubmissionResult.from_outcomes(
                        SourceSubmissionOutcome(
                            status="submitted",
                            scope="frame",
                            dataset_id="gfs",
                            cycle="2026021300",
                            run_id=DEFAULT_RUN_ID,
                            frame_id="003",
                        )
                    ),
                    SourceSubmissionResult.from_outcomes(
                        SourceSubmissionOutcome(
                            status="skipped",
                            scope="object",
                            dataset_id="gfs",
                            source_key="gfs.20260213/00/atmos/not-a-match.grib2",
                        )
                    ),
                ),
            ) as submit_source,
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event_for_keys(
                    (
                        "gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003",
                        "gfs.20260213/00/atmos/not-a-match.grib2",
                    )
                ),
                None,
            )

        assert result == {"ok": True, "submitted": 1, "seen": 2}
        assert submit_source.call_count == 2
        assert submit_source.call_args_list[0].kwargs["queue"] == "weather-etl"
        assert submit_source.call_args_list[0].kwargs["source_object"].bucket == "noaa-gfs-bdp-pds"
        assert (
            submit_source.call_args_list[0].kwargs["source_object"].key
            == "gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"
        )
        assert submit_source.call_args_list[1].kwargs["source_object"].key == "gfs.20260213/00/atmos/not-a-match.grib2"

    def test_handler_submits_job_for_current_pipeline_config_schema(self, tmp_path: Path) -> None:
        payload = minimal_pipeline_config()
        wind_config = wind_artifact_config()
        add_dataset_artifact(
            payload,
            dataset_id="gfs",
            artifact_id="wind10m_uv",
            artifact_config=wind_config,
        )
        payload["datasets"]["gfs"]["workload"]["frame_end"] = 6
        payload["datasets"]["gfs"]["workload"]["artifacts"] = ["tmp_surface", "wind10m_uv"]

        cfg_path = tmp_path / "pipeline.json"
        catalog_path = tmp_path / "catalog.json"
        artifact_root = tmp_path / "artifacts"
        cfg_path.write_text(json.dumps(payload), encoding="utf-8")
        catalog_path.write_text('{"catalogVersion":"test","rasterLayers":[]}\n', encoding="utf-8")
        with (
            patch.dict(
                os.environ,
                {
                    "ARTIFACT_ROOT_URI": f"file://{artifact_root.as_posix()}",
                    "PIPELINE_URI": f"file://{cfg_path.as_posix()}",
                    "CATALOG_URI": f"file://{catalog_path.as_posix()}",
                },
                clear=False,
            ),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"),
                None,
            )

        assert result == {"ok": True, "submitted": 1, "seen": 1}
        assert len(self.batch.submissions) == 1
        submission = self.batch.submissions[0]
        assert submission["jobQueue"] == "weather-etl"
        assert submission["jobDefinition"] == "weather-etl-worker:1"
        env = {item["name"]: item["value"] for item in submission["containerOverrides"]["environment"]}
        assert env["CYCLE"] == "2026021300"
        assert env["RUN_ID"] == DEFAULT_RUN_ID
        assert env["FRAME_ID"] == "003"
        assert env["DATASET_ID"] == "gfs"
        assert env["GRIB_SOURCE_URI"] == "s3://noaa-gfs-bdp-pds/gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"
        assert (
            env["PIPELINE_URI"]
            == f"file://{artifact_root.as_posix()}/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/pipeline.json"
        )
        assert (
            env["CATALOG_URI"]
            == f"file://{artifact_root.as_posix()}/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/catalog.json"
        )
        assert self.ddb.items["gfs#2026021300"]["run_id"] == DEFAULT_RUN_ID

    def test_handler_filters_by_frame(self, loaded_run_snapshot_factory) -> None:
        loaded_snapshot = loaded_run_snapshot_factory(frame_start=0, frame_end=3)
        with (
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f006"),
                None,
            )

        assert result == {"ok": True, "submitted": 0, "seen": 1}
        assert self.batch.submissions == []

    def test_handler_skips_when_no_work_items_are_configured(
        self,
        pipeline_config_factory,
        loaded_run_snapshot_factory,
    ) -> None:
        cfg = _pipeline_with_workload(
            pipeline_config_factory(),
            artifacts=(),
        )
        loaded_snapshot = loaded_run_snapshot_factory(pipeline_config=cfg)
        with (
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f000"),
                None,
            )

        assert result == {"ok": True, "submitted": 0, "seen": 1}
        assert self.batch.submissions == []

    def test_handler_preserves_cycle_cadence_filter(self, loaded_run_snapshot_factory) -> None:
        loaded_snapshot = loaded_run_snapshot_factory(
            artifacts=("tmp_surface", "wind10m_uv"),
        )
        with (
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event("gfs.20260213/03/atmos/gfs.t03z.pgrb2.0p25.f000"),
                None,
            )

        assert result == {"ok": True, "submitted": 0, "seen": 1}
        assert self.batch.submissions == []

    def test_handler_skips_unknown_key_formats(self, loaded_run_snapshot_factory) -> None:
        loaded_snapshot = loaded_run_snapshot_factory(
            artifacts=("tmp_surface", "wind10m_uv"),
        )
        with (
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event("gfs.20260213/00/atmos/not-a-match.grib2"),
                None,
            )

        assert result == {"ok": True, "submitted": 0, "seen": 1}
        assert self.batch.submissions == []

    def test_handler_reuses_existing_run_id_for_same_cycle(self, loaded_run_snapshot_factory) -> None:
        run_id = "20260213T010203Z-abcdef12"
        self.ddb.items["gfs#2026021300"] = {"run_id": run_id}
        loaded_snapshot = loaded_run_snapshot_factory(frame_start=0, frame_end=3, run_id=run_id)
        with (
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = gfs_ingest_lambda.handler(
                _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003"),
                None,
            )

        assert result["submitted"] == 1
        env = {item["name"]: item["value"] for item in self.batch.submissions[0]["containerOverrides"]["environment"]}
        assert env["RUN_ID"] == run_id

    def test_duplicate_sns_event_skips_actively_claimed_frame(self, loaded_run_snapshot_factory) -> None:
        loaded_snapshot = loaded_run_snapshot_factory(frame_start=0, frame_end=3)
        event = _sns_event("gfs.20260213/00/atmos/gfs.t00z.pgrb2.0p25.f003")
        with (
            patch("weather_etl.environment.ensure_or_load_run_snapshot", return_value=loaded_snapshot),
            patch("weather_etl.adapters.aws.gfs_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            first = gfs_ingest_lambda.handler(event, None)
            second = gfs_ingest_lambda.handler(event, None)

        assert first["submitted"] == 1
        assert second["submitted"] == 0
        assert len(self.batch.submissions) == 1
        claim = self.ddb.items[f"gfs#2026021300#{DEFAULT_RUN_ID}#003"]
        assert claim["state"] == "claimed"

    def _client(self, name: str):
        if name == "batch":
            return self.batch
        if name == "dynamodb":
            return self.ddb
        raise AssertionError(f"unexpected boto3 client: {name}")


def _pipeline_with_workload(config, *, frames: tuple[str, ...] | None = None, artifacts: tuple[str, ...] | None = None):
    dataset = config.dataset("gfs")
    workload = dataset.workload.model_copy(
        update={
            "frames": frames if frames is not None else dataset.workload.frames,
            "artifacts": artifacts if artifacts is not None else dataset.workload.artifacts,
        }
    )
    selected_artifacts = set(workload.artifacts)
    updated_dataset = dataset.model_copy(
        update={
            "workload": workload,
            "artifacts": {
                artifact_id: artifact
                for artifact_id, artifact in dataset.artifacts.items()
                if artifact_id in selected_artifacts
            },
        }
    )
    return config.model_copy(update={"datasets": {**config.datasets, "gfs": updated_dataset}})
