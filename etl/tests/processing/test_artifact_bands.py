from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tests.fixtures.artifact_configs import (
    gfs_precip_total_config,
    icon_precip_type_config,
    minimal_artifact_config,
    precip_rate_config,
    precip_type_config,
    thunderstorm_mask_config,
)
from tests.fixtures.artifact_specs import artifact_spec, icon_artifact_spec
from tests.fixtures.grids import small_grid_meta_fixture
from tests.fixtures.proc import noop_run
from weather_etl.processing.artifact_bands import extract_artifact_bands
from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.derivations.dispatch import extract_derived_artifact_bands
from weather_etl.sources.prepared_grib import PreparedGribSource


def test_direct_artifact_facade_delegates_to_direct_extraction(tmp_path: Path) -> None:
    artifact = artifact_spec("tmp_surface", minimal_artifact_config())
    source = PreparedGribSource.grib(
        uri="file:///tmp/input.grib2",
        path=Path("/tmp/input.grib2"),
        grid_id="gfs_0p25_global",
    )
    grid = small_grid_meta_fixture()
    band = ExtractedBand(component_id="value", source_f32_bytes=b"f32", source_byte_order="little")

    with patch(
        "weather_etl.processing.artifact_bands.extract_grib_source_band",
        return_value=band,
    ) as extract_grib_source_band:
        result = extract_artifact_bands(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=tmp_path,
            run=noop_run,
            frame_id="003",
        )

    assert result == [band]
    extract_grib_source_band.assert_called_once()
    assert extract_grib_source_band.call_args.kwargs["artifact"] == artifact
    assert extract_grib_source_band.call_args.kwargs["band_id"] == "value"
    assert extract_grib_source_band.call_args.kwargs["grib_match"] == {"GRIB_ELEMENT": "TMP", "GRIB_SHORT_NAME": "2-HTGL"}


def test_derived_dispatch_routes_each_derivation_family(tmp_path: Path) -> None:
    source = PreparedGribSource.grib(
        uri="file:///tmp/input.grib2",
        path=Path("/tmp/input.grib2"),
        grid_id="gfs_0p25_global",
    )
    grid = small_grid_meta_fixture()
    band = ExtractedBand(component_id="value", source_f32_bytes=b"f32", source_byte_order="little")

    cases = [
        (
            "precip_total_surface",
            gfs_precip_total_config(),
            artifact_spec,
            "weather_etl.processing.derivations.dispatch.extract_gfs_run_total_precip",
            band,
        ),
        (
            "prate_surface",
            precip_rate_config(),
            icon_artifact_spec,
            "weather_etl.processing.derivations.dispatch.extract_icon_tot_prec_delta_rate",
            band,
        ),
        (
            "precip_type_surface",
            precip_type_config(),
            artifact_spec,
            "weather_etl.processing.derivations.dispatch.extract_gfs_precip_type_overlay",
            [band],
        ),
        (
            "precip_type_surface",
            icon_precip_type_config(),
            icon_artifact_spec,
            "weather_etl.processing.derivations.dispatch.extract_icon_precip_type_overlay",
            [band],
        ),
        (
            "thunderstorm_mask",
            thunderstorm_mask_config(),
            icon_artifact_spec,
            "weather_etl.processing.derivations.dispatch.extract_icon_thunderstorm_mask",
            band,
        ),
    ]

    for artifact_id, raw_config, artifact_builder, patch_path, return_value in cases:
        artifact = artifact_builder(artifact_id, raw_config)
        with patch(patch_path, return_value=return_value) as extractor:
            result = extract_derived_artifact_bands(
                artifact=artifact,
                grid=grid,
                source=source,
                workdir=tmp_path,
                run=noop_run,
                frame_id="003",
            )

        assert result == [band]
        extractor.assert_called_once()
        assert extractor.call_args.kwargs["artifact"] == artifact
