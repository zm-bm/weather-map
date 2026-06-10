from __future__ import annotations

from pathlib import Path

import pytest
from weather_etl.sources.icon.params import ICON_PARAM_SELECTOR_KEY
from weather_etl.sources.prepared_grib import PreparedGribSource


def test_single_grib_source_uses_one_path_for_reference_and_components(tmp_path: Path) -> None:
    path = tmp_path / "input.grib2"
    path.write_bytes(b"grib")

    source = PreparedGribSource.grib(uri="file:///tmp/input.grib2", path=path, grid_id="gfs_0p25_global")

    assert source.reference_grib_path() == path
    assert (
        source.component_grib_path(
            artifact_id="tmp_surface",
            component_id="value",
            grib_match={"GRIB_ELEMENT": "TMP"},
        )
        == path
    )


def test_grib_collection_requires_non_empty_paths() -> None:
    with pytest.raises(SystemExit) as raised:
        PreparedGribSource.grib_collection(
            uri="icon-dwd://icon/2026041200/003",
            grib_paths={},
            grid_id="icon_global_regridded_0p125",
            selector_key=ICON_PARAM_SELECTOR_KEY,
        )

    assert "requires at least one GRIB path" in str(raised.value)


def test_grib_collection_requires_selector_key_in_component_match(tmp_path: Path) -> None:
    path = tmp_path / "tmp.regridded.grib2"
    source = PreparedGribSource.grib_collection(
        uri="icon-dwd://icon/2026041200/003",
        grib_paths={"t_2m": path},
        grid_id="icon_global_regridded_0p125",
        selector_key=ICON_PARAM_SELECTOR_KEY,
    )

    with pytest.raises(SystemExit) as raised:
        source.component_grib_path(
            artifact_id="tmp_surface",
            component_id="value",
            grib_match={"GRIB_ELEMENT": "TMP"},
        )

    assert "requires ICON_PARAM" in str(raised.value)


def test_grib_collection_rejects_unknown_selector_value(tmp_path: Path) -> None:
    path = tmp_path / "tmp.regridded.grib2"
    source = PreparedGribSource.grib_collection(
        uri="icon-dwd://icon/2026041200/003",
        grib_paths={"t_2m": path},
        grid_id="icon_global_regridded_0p125",
        selector_key=ICON_PARAM_SELECTOR_KEY,
    )

    with pytest.raises(SystemExit) as raised:
        source.component_grib_path(
            artifact_id="tmp_surface",
            component_id="value",
            grib_match={"ICON_PARAM": "rh_2m"},
        )

    assert "missing ICON_PARAM 'rh_2m'" in str(raised.value)


def test_grib_collection_normalizes_selector_values_and_supports_custom_selector_key(tmp_path: Path) -> None:
    path = tmp_path / "tmp.regridded.grib2"
    source = PreparedGribSource.grib_collection(
        uri="custom://source",
        grib_paths={"T_2M": path},
        grid_id="custom_grid",
        selector_key="MODEL_PARAM",
    )

    assert source.reference_grib_path() == path
    assert (
        source.component_grib_path(
            artifact_id="tmp_surface",
            component_id="value",
            grib_match={"MODEL_PARAM": "t_2m"},
        )
        == path
    )
