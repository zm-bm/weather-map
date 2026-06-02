from __future__ import annotations

import io
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from forecast_etl import cli
from forecast_etl.tests.cli.helpers import FakePipelineConfig


class CliDiscoveryTest(unittest.TestCase):
    def test_list_frames_prints_configured_frames(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000", "003", "006"))
        out = io.StringIO()

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config", return_value=fake_cfg),
            redirect_stdout(out),
        ):
            result = cli.main(["list-frames", "--dataset-id", "gfs"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue(), "000\n003\n006\n")

    def test_pipeline_config_overlay_uri_is_passed_to_loader(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000",))
        out = io.StringIO()

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config", return_value=fake_cfg) as load_pipeline_config,
            redirect_stdout(out),
        ):
            result = cli.main([
                "list-frames",
                "--dataset-id",
                "gfs",
                "--pipeline-config-uri",
                "file:///tmp/base.json",
                "--pipeline-config-overlay-uri",
                "file:///tmp/local.json",
            ])

        self.assertEqual(result, 0)
        self.assertEqual(load_pipeline_config.call_args.args, ("file:///tmp/base.json",))
        self.assertEqual(load_pipeline_config.call_args.kwargs["overlay_uri"], "file:///tmp/local.json")

    def test_list_frames_uses_dataset_env_fallback(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("012",))
        out = io.StringIO()

        with (
            patch.dict(os.environ, {"DATASET_ID": "gfs"}, clear=False),
            patch("forecast_etl.workflows.context.load_pipeline_config", return_value=fake_cfg),
            redirect_stdout(out),
        ):
            result = cli.main(["list-frames"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue(), "012\n")

    def test_list_frames_rejects_unknown_dataset(self) -> None:
        fake_cfg = FakePipelineConfig(frames=("000",))

        with patch("forecast_etl.workflows.context.load_pipeline_config", return_value=fake_cfg):
            with self.assertRaises(SystemExit) as raised:
                cli.main(["list-frames", "--dataset-id", "icon"])

        self.assertIn("Unknown dataset 'icon'", str(raised.exception))

    def test_list_datasets_prints_configured_datasets(self) -> None:
        fake_cfg = FakePipelineConfig(dataset_ids=("gfs", "icon"))
        out = io.StringIO()

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config", return_value=fake_cfg),
            redirect_stdout(out),
        ):
            result = cli.main(["list-datasets"])

        self.assertEqual(result, 0)
        self.assertEqual(out.getvalue(), "gfs\nicon\n")

    def test_list_datasets_passes_pipeline_config_overlay_uri_to_loader(self) -> None:
        fake_cfg = FakePipelineConfig(dataset_ids=("gfs",))
        out = io.StringIO()

        with (
            patch("forecast_etl.workflows.context.load_pipeline_config", return_value=fake_cfg) as load_pipeline_config,
            redirect_stdout(out),
        ):
            result = cli.main(
                [
                    "list-datasets",
                    "--pipeline-config-uri",
                    "file:///tmp/base.json",
                    "--pipeline-config-overlay-uri",
                    "file:///tmp/local.json",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(load_pipeline_config.call_args.args, ("file:///tmp/base.json",))
        self.assertEqual(load_pipeline_config.call_args.kwargs["overlay_uri"], "file:///tmp/local.json")



if __name__ == "__main__":
    unittest.main()
