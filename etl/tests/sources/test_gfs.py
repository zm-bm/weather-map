from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from tests.fixtures.pipeline import minimal_pipeline_config
from weather_etl.config.pipeline import (
    SourceConfig,
    parse_pipeline_config,
)
from weather_etl.sources.gfs.config import parse_gfs_nomads_source
from weather_etl.sources.gfs.layout import gfs_s3_grib_key, gfs_s3_grib_uri
from weather_etl.sources.gfs.nomads import NOMADS_DOWNLOAD_TIMEOUT_SECONDS, download_if_needed
from weather_etl.sources.registry import acquire_prepared_source
from weather_etl.storage.routing import make_store
from weather_etl.storage.uris import file_uri


def test_gfs_s3_grib_layout_uses_noaa_bucket_key_shape() -> None:
    assert gfs_s3_grib_key(cycle="2026042806", frame_id="003") == "gfs.20260428/06/atmos/gfs.t06z.pgrb2.0p25.f003"
    assert (
        gfs_s3_grib_uri(source_bucket="noaa-gfs-bdp-pds", cycle="2026042806", frame_id="003")
        == "s3://noaa-gfs-bdp-pds/gfs.20260428/06/atmos/gfs.t06z.pgrb2.0p25.f003"
    )


def test_gfs_adapter_uses_source_uri_override(tmp_path: Path) -> None:
    dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")
    source_path = tmp_path / "source.grib2"
    source_path.write_bytes(b"grib")
    workdir = tmp_path / "work"
    workdir.mkdir()

    source = acquire_prepared_source(
        dataset=dataset,
        cycle="2026041200",
        frame_id="000",
        source_uri_override=source_path.as_posix(),
        artifact_ids=dataset.workload.artifacts,
        workdir=workdir,
        store=make_store(),
    )

    assert source.grid_id == "gfs_0p25_global"
    assert source.uri == file_uri(source_path)
    assert source.reference_grib_path() == workdir / "input.grib2"
    assert (
        source.component_grib_path(
            artifact_id="tmp_surface",
            component_id="value",
            grib_match={"GRIB_ELEMENT": "TMP"},
        )
        == workdir / "input.grib2"
    )
    assert source.reference_grib_path().read_bytes() == b"grib"


def test_gfs_source_rejects_regrid_image_field() -> None:
    dataset = parse_pipeline_config(minimal_pipeline_config()).dataset("gfs")
    raw = dict(dataset.source.raw)
    raw["regrid_image"] = "ghcr.io/example/regrid:latest"

    with pytest.raises(SystemExit) as raised:
        parse_gfs_nomads_source(SourceConfig(**raw))

    assert "regrid_image" in str(raised.value)


def test_nomads_download_uses_default_timeout(tmp_path: Path) -> None:
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.read.side_effect = [b"grib", b""]

    with patch("weather_etl.sources.gfs.nomads.urllib.request.urlopen", return_value=response) as urlopen:
        assert download_if_needed("https://nomads.example.test/filter", tmp_path / "input.grib2")

    request = urlopen.call_args.args[0]
    assert request.full_url == "https://nomads.example.test/filter"
    assert urlopen.call_args.kwargs["timeout"] == NOMADS_DOWNLOAD_TIMEOUT_SECONDS
