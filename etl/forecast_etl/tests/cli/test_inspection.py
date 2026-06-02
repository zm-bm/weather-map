from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from forecast_etl import cli
from forecast_etl.tests.cli.helpers import DEFAULT_RUN_ID


class CliInspectionTest(unittest.TestCase):
    def test_runs_json_outputs_operator_report(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-runs",
            "schema_version": 1,
            "dataset_id": "gfs",
            "cycle": "2026021300",
            "run_count": 0,
            "runs": [],
        }

        with patch("forecast_etl.workflows.inspection.runs_report", return_value=report), redirect_stdout(out):
            result = cli.main(["runs", "--dataset-id", "gfs", "--cycle", "2026021300", "--json"])

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(out.getvalue())["schema"], "weather-map.etl-operator-runs")

    def test_status_human_output_includes_core_run_state(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-status",
            "schema_version": 1,
            "dataset_id": "gfs",
            "cycle": "2026021300",
            "run_id": DEFAULT_RUN_ID,
            "state": "complete",
            "ambiguous": False,
            "run_count": 1,
            "warnings": [],
            "run": {
                "run_id": DEFAULT_RUN_ID,
                "markers": {"expected": 1, "completed": 1, "missing": 0},
                "validation": {"status": "passed"},
                "published": {"status": "present"},
            },
        }

        with patch("forecast_etl.workflows.inspection.status_report", return_value=report), redirect_stdout(out):
            result = cli.main(["status", "--dataset-id", "gfs", "--cycle", "2026021300"])

        text = out.getvalue()
        self.assertEqual(result, 0)
        self.assertIn("dataset_id=gfs", text)
        self.assertIn(f"run_id={DEFAULT_RUN_ID}", text)
        self.assertIn("state=complete", text)
        self.assertIn("run.markers.completed=1", text)
        self.assertIn("run.validation.status=passed", text)
        self.assertIn("run.published.status=present", text)

    def test_status_multiple_runs_warns_but_exits_zero(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-status",
            "schema_version": 1,
            "dataset_id": "gfs",
            "cycle": "2026021300",
            "run_id": DEFAULT_RUN_ID,
            "state": "incomplete",
            "ambiguous": True,
            "run_count": 2,
            "warnings": ["multiple runs exist; publishing requires an explicit run id"],
            "run": None,
        }

        with patch("forecast_etl.workflows.inspection.status_report", return_value=report), redirect_stdout(out):
            result = cli.main(["status", "--dataset-id", "gfs", "--cycle", "2026021300"])

        self.assertEqual(result, 0)
        self.assertIn("ambiguous=true", out.getvalue())
        self.assertIn("publishing requires an explicit run id", out.getvalue())

    def test_pointers_json_outputs_operator_report(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-operator-pointers",
            "schema_version": 1,
            "dataset": "gfs",
            "cycle": "2026021300",
            "latest": {"status": "valid"},
            "current": {"status": "valid"},
        }

        with patch("forecast_etl.workflows.inspection.pointers_report", return_value=report), redirect_stdout(out):
            result = cli.main(["pointers", "--dataset-id", "gfs", "--cycle", "2026021300", "--json"])

        self.assertEqual(result, 0)
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["schema"], "weather-map.etl-operator-pointers")
        self.assertEqual(parsed["latest"]["status"], "valid")

    def test_cleanup_runs_json_outputs_candidate_report(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-cleanup-candidates",
            "schema_version": 1,
            "dataset": "gfs",
            "cycle": None,
            "candidate_count": 1,
            "protected_count": 0,
            "runs": [
                {
                    "dataset": "gfs",
                    "cycle": "2026021300",
                    "run_id": DEFAULT_RUN_ID,
                    "state": "incomplete",
                    "candidate": True,
                    "protected": False,
                    "reason": "incomplete older than 24h",
                    "age_hours": 25.0,
                    "object_count": 1,
                    "total_bytes": 2,
                    "run_prefix": f"runs/gfs/2026021300/{DEFAULT_RUN_ID}",
                }
            ],
        }

        with patch("forecast_etl.workflows.inspection.cleanup_runs_report", return_value=report), redirect_stdout(out):
            result = cli.main(["cleanup-runs", "--dataset-id", "gfs", "--json"])

        self.assertEqual(result, 0)
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["schema"], "weather-map.etl-cleanup-candidates")
        self.assertEqual(parsed["candidate_count"], 1)

    def test_cleanup_runs_passes_cycle_filter(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-cleanup-candidates",
            "schema_version": 1,
            "dataset": "gfs",
            "cycle": "2026021300",
            "candidate_count": 0,
            "protected_count": 0,
            "runs": [],
        }

        with patch("forecast_etl.workflows.inspection.cleanup_runs_report", return_value=report) as cleanup_runs_report, redirect_stdout(out):
            result = cli.main(["cleanup-runs", "--dataset-id", "gfs", "--cycle", "2026021300", "--json"])

        self.assertEqual(result, 0)
        self.assertEqual(cleanup_runs_report.call_args.kwargs["cycle"], "2026021300")

    def test_cleanup_runs_human_output_includes_candidate_reason(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-cleanup-candidates",
            "schema_version": 1,
            "dataset": "gfs",
            "cycle": "2026021300",
            "candidate_count": 1,
            "protected_count": 0,
            "runs": [
                {
                    "dataset": "gfs",
                    "cycle": "2026021300",
                    "run_id": DEFAULT_RUN_ID,
                    "state": "incomplete",
                    "candidate": True,
                    "protected": False,
                    "reason": "incomplete older than 24h",
                    "age_hours": 25.0,
                    "object_count": 1,
                    "total_bytes": 2,
                    "run_prefix": f"runs/gfs/2026021300/{DEFAULT_RUN_ID}",
                }
            ],
        }

        with patch("forecast_etl.workflows.inspection.cleanup_runs_report", return_value=report), redirect_stdout(out):
            result = cli.main(["cleanup-runs", "--dataset-id", "gfs", "--cycle", "2026021300"])

        text = out.getvalue()
        self.assertEqual(result, 0)
        self.assertIn("candidate_count=1", text)
        self.assertIn("runs.0.candidate=true", text)
        self.assertIn("runs.0.reason=incomplete older than 24h", text)

    def test_cleanup_runs_delete_requires_yes(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            cli.main(["cleanup-runs", "--dataset-id", "gfs", "--delete"])

        self.assertIn("--yes", str(raised.exception))

    def test_cleanup_runs_delete_yes_passes_delete_flag(self) -> None:
        out = io.StringIO()
        report = {
            "schema": "weather-map.etl-cleanup-candidates",
            "schema_version": 1,
            "dataset": "gfs",
            "cycle": None,
            "mode": "delete",
            "candidate_count": 1,
            "protected_count": 0,
            "deleted_object_count": 2,
            "deleted_bytes": 5,
            "delete_error_count": 0,
            "runs": [],
        }

        with patch("forecast_etl.workflows.inspection.cleanup_runs_report", return_value=report) as cleanup_runs_report, redirect_stdout(out):
            result = cli.main(["cleanup-runs", "--dataset-id", "gfs", "--delete", "--yes", "--json"])

        self.assertEqual(result, 0)
        self.assertTrue(cleanup_runs_report.call_args.kwargs["delete_candidates"])
        self.assertEqual(json.loads(out.getvalue())["mode"], "delete")



if __name__ == "__main__":
    unittest.main()
