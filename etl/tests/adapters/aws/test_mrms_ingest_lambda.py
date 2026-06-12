from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from weather_etl.adapters.aws import mrms_ingest_lambda
from weather_etl.sources.submission import SourceSubmissionOutcome, SourceSubmissionResult


def _sqs_sns_event(*keys: str, bucket: str = "noaa-mrms-pds") -> dict:
    s3_event = {
        "Records": [
            {
                "s3": {
                    "bucket": {"name": bucket},
                    "object": {"key": key},
                }
            }
            for key in keys
        ]
    }
    sns_payload = {
        "Type": "Notification",
        "TopicArn": "arn:aws:sns:us-east-1:123901341784:NewMRMSObject",
        "Message": json.dumps(s3_event),
    }
    return {"Records": [{"eventSource": "aws:sqs", "body": json.dumps(sns_payload)}]}


class TestAwsMrmsIngest:
    @pytest.fixture(autouse=True)
    def setup_handler(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.batch = FakeBatchClient()
        self.ddb = FakeDynamoClient()
        monkeypatch.setenv("ARTIFACT_ROOT_URI", "file:///tmp/weather-mrms-artifacts")
        monkeypatch.setenv("PIPELINE_URI", "file:///tmp/weather-mrms-pipeline.json")
        monkeypatch.setenv("CATALOG_URI", "file:///tmp/weather-mrms-catalog.json")
        monkeypatch.setenv("BATCH_JOB_QUEUE", "weather-etl")
        monkeypatch.setenv("BATCH_JOB_DEFINITION", "weather-etl-worker-mrms:1")
        monkeypatch.setenv("FRAME_CLAIM_TABLE", "frame-claims")

    def test_handler_delegates_sqs_sns_s3_objects_to_command(self) -> None:
        key = (
            "CONUS/ReflectivityAtLowestAltitude_00.50/20260611/"
            "MRMS_ReflectivityAtLowestAltitude_00.50_20260611-053640.grib2.gz"
        )
        with (
            patch(
                "weather_etl.adapters.aws.mrms_ingest_lambda.submit_mrms_source_object",
                return_value=SourceSubmissionResult.from_outcomes(
                    SourceSubmissionOutcome(
                        status="submitted",
                        scope="frame",
                        dataset_id="mrms",
                        cycle="2026061105",
                        run_id="20260611T053640Z-abcdef12",
                        frame_id="20260611053640",
                    )
                ),
            ) as submit_source,
            patch("weather_etl.adapters.aws.mrms_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = mrms_ingest_lambda.handler(_sqs_sns_event(key), None)

        assert result == {"ok": True, "submitted": 1, "pending": 0, "seen": 1}
        submit_source.assert_called_once()
        assert submit_source.call_args.kwargs["queue"] == "weather-etl"
        assert submit_source.call_args.kwargs["job_definition"] == "weather-etl-worker-mrms:1"
        assert submit_source.call_args.kwargs["source_object"].bucket == "noaa-mrms-pds"
        assert submit_source.call_args.kwargs["source_object"].key == key

    def test_handler_reports_pending_pair_waits(self) -> None:
        key = (
            "CONUS/MergedReflectivityQCComposite_00.50/20260611/"
            "MRMS_MergedReflectivityQCComposite_00.50_20260611-053640.grib2.gz"
        )
        with (
            patch(
                "weather_etl.adapters.aws.mrms_ingest_lambda.submit_mrms_source_object",
                return_value=SourceSubmissionResult.from_outcomes(
                    SourceSubmissionOutcome(
                        status="pending",
                        scope="frame",
                        dataset_id="mrms",
                        cycle="2026061105",
                        frame_id="20260611053640",
                    )
                ),
            ),
            patch("weather_etl.adapters.aws.mrms_ingest_lambda.boto3.client", side_effect=self._client),
        ):
            result = mrms_ingest_lambda.handler(_sqs_sns_event(key), None)

        assert result == {"ok": True, "submitted": 0, "pending": 1, "seen": 1}

    def test_handler_returns_empty_when_no_supported_payloads(self) -> None:
        with patch("weather_etl.adapters.aws.mrms_ingest_lambda.boto3.client", side_effect=self._client):
            result = mrms_ingest_lambda.handler({"Records": [{"body": "{}"}]}, None)

        assert result == {"ok": True, "submitted": 0, "seen": 0}

    def _client(self, name: str):
        if name == "batch":
            return self.batch
        if name == "dynamodb":
            return self.ddb
        raise AssertionError(name)
