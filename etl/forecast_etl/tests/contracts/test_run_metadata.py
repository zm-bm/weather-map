from __future__ import annotations

import unittest
from unittest.mock import patch

from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.run_metadata import metadata_value, pipeline_config_digest, run_metadata_from_env
from forecast_etl.tests.fixtures.pipeline import minimal_pipeline_config


class RunMetadataTest(unittest.TestCase):
    def test_pipeline_config_digest_is_stable_for_resolved_config(self) -> None:
        config = parse_pipeline_config(minimal_pipeline_config())

        digest = pipeline_config_digest(config)

        self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")
        self.assertEqual(pipeline_config_digest(config), digest)

    def test_run_metadata_from_env_uses_worker_provenance(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "ETL_CODE_REVISION": "abc123",
                "ETL_IMAGE_IDENTITY": "weather-etl-worker:abc123",
            },
            clear=True,
        ):
            metadata = run_metadata_from_env(config_digest="sha256:" + "1" * 64)

        self.assertEqual(metadata.code_revision, "abc123")
        self.assertEqual(metadata.image_identity, "weather-etl-worker:abc123")
        self.assertEqual(metadata.config_digest, "sha256:" + "1" * 64)

    def test_metadata_value_falls_back_to_unknown(self) -> None:
        self.assertEqual(metadata_value(" \n "), "unknown")


if __name__ == "__main__":
    unittest.main()
