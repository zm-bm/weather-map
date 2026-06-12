from __future__ import annotations

from unittest.mock import patch

import pytest
from tests.fixtures.pipeline import minimal_pipeline_config, raw_pipeline_config
from weather_etl.config.pipeline import SourceConfig, parse_pipeline_config
from weather_etl.config.sources import ICON_DWD_SOURCE_TYPE, MRMS_AWS_S3_SOURCE_TYPE
from weather_etl.sources.registry import (
    aws_batch_source_uri_overrides,
    resolve_source_frame_ids,
    source_frame_datetime,
    source_frame_valid_times,
)


def test_forecast_sources_use_default_frame_resolution_and_no_observed_times() -> None:
    dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")

    assert resolve_source_frame_ids(dataset=dataset, selected_frames=("000",)) == ("000",)
    assert source_frame_valid_times(dataset, ("000",)) is None
    with pytest.raises(SystemExit, match="does not expose observed timestamp frame ids"):
        source_frame_datetime(dataset=dataset, frame_id="000")


def test_gfs_source_exposes_aws_batch_uri_overrides() -> None:
    dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")

    assert aws_batch_source_uri_overrides(
        dataset=dataset,
        cycle="2026042806",
        frames=("000", "003"),
        source_bucket="noaa-gfs-bdp-pds",
    ) == {
        "000": "s3://noaa-gfs-bdp-pds/gfs.20260428/06/atmos/gfs.t06z.pgrb2.0p25.f000",
        "003": "s3://noaa-gfs-bdp-pds/gfs.20260428/06/atmos/gfs.t06z.pgrb2.0p25.f003",
    }


def test_source_without_aws_batch_uri_hook_uses_empty_overrides() -> None:
    dataset = parse_pipeline_config(
        raw_pipeline_config(
            dataset_ids=("icon",),
            source_types={"icon": ICON_DWD_SOURCE_TYPE},
        )
    ).dataset("icon")

    assert (
        aws_batch_source_uri_overrides(
            dataset=dataset,
            cycle="2026042806",
            frames=("001",),
            source_bucket="ignored",
        )
        == {}
    )


def test_mrms_source_exposes_observed_frame_hooks() -> None:
    dataset = _mrms_dataset()

    with patch("weather_etl.sources.registry.mrms_source.discover_recent_frame_ids") as discover:
        discover.return_value = ("20260611000000",)
        assert resolve_source_frame_ids(dataset=dataset, selected_frames=None, store=None) == ("20260611000000",)

    discover.assert_called_once_with(dataset=dataset, lookback_minutes=120, store=None)
    assert resolve_source_frame_ids(dataset=dataset, selected_frames=("20260611000000",)) == ("20260611000000",)
    assert source_frame_valid_times(dataset, ("20260611053640",)) == {"20260611053640": "2026-06-11T05:36:40Z"}
    assert source_frame_datetime(dataset=dataset, frame_id="20260611053640").isoformat() == (
        "2026-06-11T05:36:40+00:00"
    )


def test_registry_rejects_unsupported_source_type() -> None:
    dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs").model_copy(
        update={"source": SourceConfig(type="future_radar", grid_id="future_grid")}
    )

    with pytest.raises(SystemExit, match="Unsupported dataset source type"):
        resolve_source_frame_ids(dataset=dataset, selected_frames=None)


def _mrms_dataset():
    return parse_pipeline_config(
        raw_pipeline_config(
            dataset_ids=("mrms",),
            source_types={"mrms": MRMS_AWS_S3_SOURCE_TYPE},
        )
    ).dataset("mrms")
