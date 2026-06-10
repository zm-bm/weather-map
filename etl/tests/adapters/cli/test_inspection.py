from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from unittest.mock import patch

from tests.fixtures.artifacts import DEFAULT_RUN_ID
from weather_etl.adapters import cli


def test_runs_json_outputs_operator_report() -> None:
    out = io.StringIO()
    report = {
        "schema": "weather-map.etl-operator-runs",
        "schema_version": 2,
        "dataset_id": "gfs",
        "cycle": "2026021300",
        "run_count": 0,
        "runs": [],
    }

    with patch("weather_etl.adapters.cli.handlers.inspect_runs", return_value=report), redirect_stdout(out):
        result = cli.main(["runs", "--dataset-id", "gfs", "--cycle", "2026021300", "--json"])

    assert result == 0
    assert json.loads(out.getvalue())["schema"] == "weather-map.etl-operator-runs"


def test_status_human_output_includes_core_run_state() -> None:
    out = io.StringIO()
    report = {
        "schema": "weather-map.etl-operator-status",
        "schema_version": 2,
        "dataset_id": "gfs",
        "cycle": "2026021300",
        "run_id": DEFAULT_RUN_ID,
        "state": "complete",
        "stage": "published",
        "ambiguous": False,
        "run_count": 1,
        "warnings": [],
        "run": {
            "run_id": DEFAULT_RUN_ID,
            "stage": "published",
            "markers": {"expected": 1, "completed": 1, "missing": 0},
            "validation": {"status": "passed"},
            "published": {"status": "present"},
        },
    }

    with patch("weather_etl.adapters.cli.handlers.inspect_status", return_value=report), redirect_stdout(out):
        result = cli.main(["status", "--dataset-id", "gfs", "--cycle", "2026021300"])

    text = out.getvalue()
    assert result == 0
    assert "dataset_id=gfs" in text
    assert f"run_id={DEFAULT_RUN_ID}" in text
    assert "state=complete" in text
    assert "stage=published" in text
    assert "run.stage=published" in text
    assert "run.markers.completed=1" in text
    assert "run.validation.status=passed" in text
    assert "run.published.status=present" in text


def test_status_multiple_runs_warns_but_exits_zero() -> None:
    out = io.StringIO()
    report = {
        "schema": "weather-map.etl-operator-status",
        "schema_version": 2,
        "dataset_id": "gfs",
        "cycle": "2026021300",
        "run_id": DEFAULT_RUN_ID,
        "state": "incomplete",
        "stage": "pending_frames",
        "ambiguous": True,
        "run_count": 2,
        "warnings": ["multiple runs exist; publishing requires an explicit run id"],
        "run": None,
    }

    with patch("weather_etl.adapters.cli.handlers.inspect_status", return_value=report), redirect_stdout(out):
        result = cli.main(["status", "--dataset-id", "gfs", "--cycle", "2026021300"])

    assert result == 0
    assert "ambiguous=true" in out.getvalue()
    assert "publishing requires an explicit run id" in out.getvalue()
