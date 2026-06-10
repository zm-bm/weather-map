from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from tests.fixtures.artifact_configs import minimal_artifact_config
from tests.fixtures.artifact_specs import artifact_spec
from tests.fixtures.grids import small_grid_meta_fixture
from tests.fixtures.proc import noop_run
from weather_etl.processing.artifact import process_artifact
from weather_etl.processing.bands import ExtractedBand
from weather_etl.processing.grid_transforms import ArtifactGridTransformResult
from weather_etl.sources.prepared_grib import PreparedGribSource


def test_process_artifact_extracts_transforms_and_encodes_payload(tmp_path: Path) -> None:
    artifact = artifact_spec("tmp_surface", minimal_artifact_config())
    grid = small_grid_meta_fixture()
    band = ExtractedBand(component_id="value", source_f32_bytes=b"f32", source_byte_order="little")
    transformed_grid = {**grid, "nx": 2, "ny": 2}
    transformed = ArtifactGridTransformResult(
        grid_id="gfs_0p25_global",
        grid=transformed_grid,
        bands=[band],
    )
    source = PreparedGribSource.grib(
        uri="file:///tmp/input.grib2",
        path=Path("/tmp/input.grib2"),
        grid_id="gfs_0p25_global",
    )

    with (
        patch("weather_etl.processing.artifact.extract_artifact_bands", return_value=[band]) as extract,
        patch(
            "weather_etl.processing.artifact.apply_artifact_grid_transform",
            return_value=transformed,
        ) as transform,
        patch("weather_etl.processing.artifact.encode_artifact_payload", return_value=b"payload") as encode,
    ):
        processed = process_artifact(
            artifact=artifact,
            source=source,
            grid=grid,
            frame_id="003",
            workdir=tmp_path,
            run=noop_run,
        )

    extract.assert_called_once_with(
        artifact=artifact,
        grid=grid,
        source=source,
        workdir=tmp_path,
        run=noop_run,
        frame_id="003",
    )
    transform.assert_called_once_with(
        artifact=artifact,
        grid_id=source.grid_id,
        grid=grid,
        bands=[band],
    )
    encode.assert_called_once_with(artifact=artifact, grid=transformed_grid, bands=[band])
    assert processed.dtype == "int16"
    assert processed.payload == b"payload"
    assert processed.grid_id == "gfs_0p25_global"
    assert processed.grid == transformed_grid
