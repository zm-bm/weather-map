from __future__ import annotations

import io
import os
from contextlib import redirect_stdout
from unittest.mock import patch

import pytest
from weather_etl.adapters import cli


class TestCliDiscovery:
    def test_list_frames_prints_configured_frames(self, loaded_product_config_factory) -> None:
        product_config = loaded_product_config_factory(frame_start=0, frame_end=2)
        out = io.StringIO()

        with (
            patch(
                "weather_etl.environment.EtlEnvironment.load_product_config",
                autospec=True,
                return_value=product_config,
            ),
            redirect_stdout(out),
        ):
            result = cli.main(["list-frames", "--dataset-id", "gfs"])

        assert result == 0
        assert out.getvalue() == "000\n001\n002\n"

    def test_list_frames_uses_dataset_env_fallback(self, loaded_product_config_factory) -> None:
        product_config = loaded_product_config_factory(frame_start=12, frame_end=12)
        out = io.StringIO()

        with (
            patch.dict(os.environ, {"DATASET_ID": "gfs"}, clear=False),
            patch(
                "weather_etl.environment.EtlEnvironment.load_product_config",
                autospec=True,
                return_value=product_config,
            ),
            redirect_stdout(out),
        ):
            result = cli.main(["list-frames"])

        assert result == 0
        assert out.getvalue() == "012\n"

    def test_list_frames_rejects_unknown_dataset(self, loaded_product_config_factory) -> None:
        product_config = loaded_product_config_factory()

        with patch(
            "weather_etl.environment.EtlEnvironment.load_product_config",
            autospec=True,
            return_value=product_config,
        ):
            with pytest.raises(SystemExit) as raised:
                cli.main(["list-frames", "--dataset-id", "icon"])

        assert "Unknown dataset 'icon'" in str(raised.value)

    def test_list_datasets_prints_configured_datasets(self, loaded_product_config_factory) -> None:
        product_config = loaded_product_config_factory(dataset_ids=("gfs", "icon"))
        out = io.StringIO()

        with (
            patch(
                "weather_etl.environment.EtlEnvironment.load_product_config",
                autospec=True,
                return_value=product_config,
            ),
            redirect_stdout(out),
        ):
            result = cli.main(["list-datasets"])

        assert result == 0
        assert out.getvalue() == "gfs\nicon\n"
