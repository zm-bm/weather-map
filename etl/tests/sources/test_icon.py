from __future__ import annotations

import bz2
import io
import os
import urllib.error
from contextlib import contextmanager
from email.message import Message
from pathlib import Path
from unittest.mock import patch

import pytest
from tests.fixtures.artifact_configs import (
    icon_precip_type_config,
    minimal_artifact_config,
    precip_rate_config,
    thunderstorm_mask_config,
)
from tests.fixtures.artifact_specs import icon_artifact_spec
from weather_etl.config.pipeline import DatasetConfig, SourceConfig, WorkloadConfig
from weather_etl.config.sources import ICON_DWD_SOURCE_TYPE
from weather_etl.sources.icon import dwd as icon_dwd
from weather_etl.sources.icon.config import parse_icon_dwd_source
from weather_etl.sources.icon.layout import (
    icon_dwd_filename,
    icon_dwd_url,
    required_icon_params,
    required_previous_icon_params,
)
from weather_etl.sources.icon.params import icon_param_from_grib_match, previous_icon_prepared_source_key
from weather_etl.sources.registry import acquire_prepared_source
from weather_etl.storage.routing import make_store


class _FakeHttpResponse(io.BytesIO):
    def __init__(self, payload: bytes, *, status: int = 200) -> None:
        super().__init__(payload)
        self.status = status
        self.headers = {"Content-Length": str(len(payload))}

    def __enter__(self) -> "_FakeHttpResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


def test_icon_dwd_url_uses_cycle_hour_parameter_folder_and_uppercase_filename() -> None:
    assert (
        icon_dwd_url(
            base_url="https://opendata.dwd.de/weather/nwp/icon/grib",
            cycle="2026042800",
            frame_id="003",
            icon_param="t_2m",
        )
        == "https://opendata.dwd.de/weather/nwp/icon/grib/00/t_2m/"
        "icon_global_icosahedral_single-level_2026042800_003_T_2M.grib2.bz2"
    )


def test_icon_regrid_command_writes_expected_output(tmp_path: Path) -> None:
    input_path = tmp_path / "input.grib2"
    output_path = tmp_path / "output.grib2"
    description_path = tmp_path / "icon_description.txt"
    weights_path = tmp_path / "icon_weights.nc"
    input_path.write_bytes(b"grib")
    description_path.write_text("gridtype = lonlat\n", encoding="utf-8")
    weights_path.write_bytes(b"weights")
    calls = []

    def fake_run(argv):
        calls.append(tuple(str(part) for part in argv))
        Path(argv[-1]).write_bytes(b"regridded")

    with (
        patch("weather_etl.sources.icon.dwd.shutil.which", return_value="/usr/bin/cdo"),
        patch("weather_etl.sources.icon.dwd.make_runner", return_value=fake_run),
    ):
        regridded = icon_dwd._regrid_if_needed(
            input_path=input_path,
            output_path=output_path,
            description_file=description_path,
            weights_file=weights_path,
        )
    output_bytes = output_path.read_bytes()

    assert regridded
    assert calls[0][0] == "/usr/bin/cdo"
    assert calls[0][1:3] == ("-f", "grb2")
    assert calls[0][3] == f"remap,{description_path.as_posix()},{weights_path.as_posix()}"
    assert calls[0][4] == input_path.as_posix()
    assert calls[0][5] == output_path.with_suffix(output_path.suffix + ".tmp").as_posix()
    assert output_bytes == b"regridded"


def test_icon_adapter_reuses_cached_regridded_files(tmp_path: Path) -> None:
    artifact_config = minimal_artifact_config()
    artifact_config["components"][0]["grib_match"] = {"ICON_PARAM": "t_2m"}
    dataset = _icon_dataset(artifact_id="tmp_surface", artifact_config=artifact_config, frame_id="000")
    regridded_path = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="000", icon_param="t_2m")

    with _cached_icon_source_patches(tmp_path):
        source = acquire_prepared_source(
            dataset=dataset,
            cycle="2026042800",
            frame_id="000",
            source_uri_override=None,
            artifact_ids=dataset.workload.artifacts,
            workdir=tmp_path / "work",
            store=make_store(),
        )

    assert source.grid_id == "icon_global_regridded_0p125"
    assert source.reference_grib_path() == regridded_path
    assert (
        source.component_grib_path(
            artifact_id="tmp_surface",
            component_id="value",
            grib_match={"ICON_PARAM": "T_2M"},
        )
        == regridded_path
    )


def test_icon_adapter_prepares_previous_tot_prec_for_derived_rate_after_first_hour(tmp_path: Path) -> None:
    dataset = _icon_dataset(
        artifact_id="prate_surface",
        artifact_config=precip_rate_config(),
        frame_id="003",
    )
    current_path = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="003", icon_param="tot_prec")
    previous_path = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="002", icon_param="tot_prec")

    with _cached_icon_source_patches(tmp_path):
        source = acquire_prepared_source(
            dataset=dataset,
            cycle="2026042800",
            frame_id="003",
            source_uri_override=None,
            artifact_ids=dataset.workload.artifacts,
            workdir=tmp_path / "work",
            store=make_store(),
        )

    assert (
        source.component_grib_path(
            artifact_id="prate_surface",
            component_id="value",
            grib_match={"ICON_PARAM": "tot_prec"},
        )
        == current_path
    )
    assert (
        source.component_grib_path(
            artifact_id="prate_surface",
            component_id="value",
            grib_match={"ICON_PARAM": previous_icon_prepared_source_key("tot_prec")},
        )
        == previous_path
    )


def test_icon_adapter_uses_zero_baseline_for_first_derived_rate_hour(tmp_path: Path) -> None:
    dataset = _icon_dataset(
        artifact_id="prate_surface",
        artifact_config=precip_rate_config(),
        frame_id="001",
    )
    current_path = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="001", icon_param="tot_prec")

    with _cached_icon_source_patches(tmp_path):
        source = acquire_prepared_source(
            dataset=dataset,
            cycle="2026042800",
            frame_id="001",
            source_uri_override=None,
            artifact_ids=dataset.workload.artifacts,
            workdir=tmp_path / "work",
            store=make_store(),
        )

    assert (
        source.component_grib_path(
            artifact_id="prate_surface",
            component_id="value",
            grib_match={"ICON_PARAM": "tot_prec"},
        )
        == current_path
    )
    with pytest.raises(SystemExit):
        source.component_grib_path(
            artifact_id="prate_surface",
            component_id="value",
            grib_match={"ICON_PARAM": previous_icon_prepared_source_key("tot_prec")},
        )


def test_icon_adapter_prepares_weather_code_for_thunderstorm_derivation(tmp_path: Path) -> None:
    thunderstorm = icon_artifact_spec("thunderstorm_mask", thunderstorm_mask_config())
    prate = icon_artifact_spec("prate_surface", precip_rate_config())
    dataset = _icon_dataset_for_artifacts(
        frame_id="003",
        artifacts={
            "prate_surface": prate,
            "thunderstorm_mask": thunderstorm,
        },
        workload_artifacts=("prate_surface", "thunderstorm_mask"),
    )
    current_tot_prec = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="003", icon_param="tot_prec")
    previous_tot_prec = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="002", icon_param="tot_prec")
    weather_code = _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="003", icon_param="ww")

    with _cached_icon_source_patches(tmp_path):
        source = acquire_prepared_source(
            dataset=dataset,
            cycle="2026042800",
            frame_id="003",
            source_uri_override=None,
            artifact_ids=dataset.workload.artifacts,
            workdir=tmp_path / "work",
            store=make_store(),
        )

    assert (
        source.component_grib_path(
            artifact_id="thunderstorm_mask",
            component_id="ww",
            grib_match={"ICON_PARAM": "ww"},
        )
        == weather_code
    )
    assert (
        source.component_grib_path(
            artifact_id="prate_surface",
            component_id="value",
            grib_match={"ICON_PARAM": "tot_prec"},
        )
        == current_tot_prec
    )
    assert (
        source.component_grib_path(
            artifact_id="prate_surface",
            component_id="value",
            grib_match={"ICON_PARAM": previous_icon_prepared_source_key("tot_prec")},
        )
        == previous_tot_prec
    )


def test_icon_required_params_respect_selected_artifacts() -> None:
    thunderstorm = icon_artifact_spec("thunderstorm_mask", thunderstorm_mask_config())
    prate = icon_artifact_spec("prate_surface", precip_rate_config())
    dataset = _icon_dataset_for_artifacts(
        frame_id="003",
        artifacts={
            "prate_surface": prate,
            "thunderstorm_mask": thunderstorm,
        },
        workload_artifacts=("prate_surface", "thunderstorm_mask"),
    )

    assert required_icon_params(dataset, ("thunderstorm_mask",)) == ("ww",)
    assert required_previous_icon_params(dataset, ("thunderstorm_mask",)) == ()
    assert required_icon_params(dataset, ("prate_surface",)) == ("tot_prec",)
    assert required_previous_icon_params(dataset, ("prate_surface",)) == ("tot_prec",)
    assert required_icon_params(dataset, ()) == ("tot_prec", "ww")
    assert required_previous_icon_params(dataset, ()) == ("tot_prec",)


def test_icon_required_params_reject_unknown_selected_artifact() -> None:
    artifact_config = minimal_artifact_config()
    artifact_config["components"][0]["grib_match"] = {"ICON_PARAM": "t_2m"}
    dataset = _icon_dataset(
        artifact_id="tmp_surface",
        artifact_config=artifact_config,
        frame_id="000",
    )

    with pytest.raises(SystemExit) as raised:
        required_icon_params(dataset, ("missing_surface",))

    assert "Unknown ICON workload artifact: missing_surface" in str(raised.value)


def test_icon_required_params_reject_missing_icon_param() -> None:
    artifact_config = minimal_artifact_config()
    artifact_config["components"][0]["grib_match"] = {"GRIB_ELEMENT": "TMP"}
    dataset = _icon_dataset(
        artifact_id="tmp_surface",
        artifact_config=artifact_config,
        frame_id="000",
    )

    with pytest.raises(SystemExit) as raised:
        required_icon_params(dataset, ("tmp_surface",))

    assert "ICON artifact tmp_surface.value missing ICON_PARAM" in str(raised.value)


def test_previous_icon_prepared_source_key_rejects_blank_param() -> None:
    with pytest.raises(SystemExit) as raised:
        previous_icon_prepared_source_key("   ")

    assert "requires a non-empty parameter" in str(raised.value)


def test_icon_param_from_grib_match_treats_non_string_param_as_missing() -> None:
    with pytest.raises(SystemExit) as raised:
        icon_param_from_grib_match(
            artifact_id="tmp_surface",
            selector_id="value",
            grib_match={"ICON_PARAM": 7},
        )

    assert "ICON artifact tmp_surface.value missing ICON_PARAM" in str(raised.value)


def test_icon_source_rejects_slash_only_base_url() -> None:
    source = _icon_source()
    raw = dict(source.raw)
    raw["base_url"] = "///"

    with pytest.raises(SystemExit) as raised:
        parse_icon_dwd_source(SourceConfig(**raw))

    assert "base_url must not be empty" in str(raised.value)


def test_icon_adapter_prepares_precip_type_component_current_and_previous_inputs(tmp_path: Path) -> None:
    dataset = _icon_dataset(
        artifact_id="precip_type_surface",
        artifact_config=icon_precip_type_config(),
        frame_id="003",
    )
    current_paths = {
        icon_param: _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="003", icon_param=icon_param)
        for icon_param in ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
    }
    previous_paths = {
        icon_param: _write_cached_icon_param(tmp_path, cycle="2026042800", frame_id="002", icon_param=icon_param)
        for icon_param in ("rain_gsp", "rain_con", "snow_gsp", "snow_con")
    }

    with _cached_icon_source_patches(tmp_path):
        source = acquire_prepared_source(
            dataset=dataset,
            cycle="2026042800",
            frame_id="003",
            source_uri_override=None,
            artifact_ids=dataset.workload.artifacts,
            workdir=tmp_path / "work",
            store=make_store(),
        )

    for icon_param, current_path in current_paths.items():
        assert (
            source.component_grib_path(
                artifact_id="precip_type_surface",
                component_id=icon_param,
                grib_match={"ICON_PARAM": icon_param},
            )
            == current_path
        )
        assert (
            source.component_grib_path(
                artifact_id="precip_type_surface",
                component_id=icon_param,
                grib_match={"ICON_PARAM": previous_icon_prepared_source_key(icon_param)},
            )
            == previous_paths[icon_param]
        )


def test_icon_regrid_requires_cdo(tmp_path: Path) -> None:
    input_path = tmp_path / "input.grib2"
    output_path = tmp_path / "output.grib2"
    input_path.write_bytes(b"grib")

    with patch("weather_etl.sources.icon.dwd.shutil.which", return_value=None):
        with pytest.raises(SystemExit) as raised:
            icon_dwd._regrid_if_needed(
                input_path=input_path,
                output_path=output_path,
            )

    assert "requires cdo" in str(raised.value)


def test_icon_regrid_requires_description_and_weights_files(tmp_path: Path) -> None:
    input_path = tmp_path / "input.grib2"
    output_path = tmp_path / "output.grib2"
    input_path.write_bytes(b"grib")
    with patch("weather_etl.sources.icon.dwd.shutil.which", return_value="/usr/bin/cdo"):
        with pytest.raises(SystemExit) as raised:
            icon_dwd._regrid_if_needed(
                input_path=input_path,
                output_path=output_path,
                description_file=tmp_path / "missing-description.txt",
                weights_file=tmp_path / "missing-weights.nc",
            )

    assert "description file not found" in str(raised.value)


def test_icon_download_http_404_is_retryable_until_wait_expires(tmp_path: Path) -> None:
    error = urllib.error.HTTPError(
        url="https://example.test/icon.grib2.bz2",
        code=404,
        msg="Not Found",
        hdrs=Message(),
        fp=io.BytesIO(b"missing"),
    )
    out_path = tmp_path / "icon.grib2.bz2"

    with (
        patch.dict(os.environ, {"ICON_SOURCE_WAIT_SECONDS": "0", "ICON_SOURCE_MIN_BYTES": "1"}, clear=False),
        patch("weather_etl.sources.icon.dwd.urllib.request.urlopen", side_effect=error),
    ):
        with pytest.raises(SystemExit) as raised:
            icon_dwd._download_if_needed("https://example.test/icon.grib2.bz2", out_path)

    assert "ICON DWD source not ready after waiting" in str(raised.value)
    assert "HTTP 404 Not Found" in str(raised.value)


def test_icon_download_retries_then_succeeds(tmp_path: Path) -> None:
    error = urllib.error.HTTPError(
        url="https://example.test/icon.grib2.bz2",
        code=404,
        msg="Not Found",
        hdrs=Message(),
        fp=io.BytesIO(b"missing"),
    )
    out_path = tmp_path / "icon.grib2.bz2"

    with (
        patch.dict(
            os.environ,
            {
                "ICON_SOURCE_WAIT_SECONDS": "1",
                "ICON_SOURCE_MIN_BYTES": "1",
                "ICON_SOURCE_RETRY_BASE_SECONDS": "0",
            },
            clear=False,
        ),
        patch("weather_etl.sources.icon.dwd.time.sleep"),
        patch(
            "weather_etl.sources.icon.dwd.urllib.request.urlopen",
            side_effect=[error, _FakeHttpResponse(b"payload")],
        ),
    ):
        downloaded = icon_dwd._download_if_needed("https://example.test/icon.grib2.bz2", out_path)
    output_bytes = out_path.read_bytes()

    assert downloaded
    assert output_bytes == b"payload"


def test_icon_prepare_cleans_bad_bz2_and_retries(tmp_path: Path) -> None:
    artifact_config = minimal_artifact_config()
    artifact_config["components"][0]["grib_match"] = {"ICON_PARAM": "t_2m"}
    dataset = _icon_dataset(artifact_id="tmp_surface", artifact_config=artifact_config, frame_id="000")

    def fake_regrid(*, output_path: Path, **kwargs) -> bool:
        output_path.write_bytes(b"regridded")
        return True

    with (
        patch.dict(
            os.environ,
            {
                "ICON_SOURCE_WAIT_SECONDS": "1",
                "ICON_SOURCE_MIN_BYTES": "1",
                "ICON_SOURCE_RETRY_BASE_SECONDS": "0",
            },
            clear=False,
        ),
        patch("weather_etl.sources.icon.dwd.default_etl_dir", return_value=tmp_path),
        patch("weather_etl.sources.icon.dwd.time.sleep"),
        patch("weather_etl.sources.icon.dwd._regrid_if_needed", side_effect=fake_regrid),
        patch(
            "weather_etl.sources.icon.dwd.urllib.request.urlopen",
            side_effect=[
                _FakeHttpResponse(b"not-bzip2"),
                _FakeHttpResponse(bz2.compress(b"grib")),
            ],
        ),
    ):
        regridded_path, downloaded = icon_dwd._prepare_icon_param(
            dataset_id=dataset.id,
            source=parse_icon_dwd_source(dataset.source),
            cycle="2026042800",
            frame_id="000",
            icon_param="t_2m",
        )
        output_bytes = regridded_path.read_bytes()

    assert downloaded
    assert output_bytes == b"regridded"


def _write_cached_icon_param(root: Path, *, cycle: str, frame_id: str, icon_param: str) -> Path:
    cache_dir = root / "cache" / "grib" / "icon" / cycle / frame_id
    cache_dir.mkdir(parents=True, exist_ok=True)
    filename = icon_dwd_filename(cycle=cycle, frame_id=frame_id, icon_param=icon_param)
    (cache_dir / filename).write_bytes(bz2.compress(b"grib"))
    (cache_dir / filename.removesuffix(".bz2")).write_bytes(b"grib")
    regridded_path = cache_dir / f"{icon_param}.regridded.grib2"
    regridded_path.write_bytes(b"regridded")
    return regridded_path


def _icon_source() -> SourceConfig:
    return SourceConfig(
        type=ICON_DWD_SOURCE_TYPE,
        grid_id="icon_global_regridded_0p125",
        base_url="https://opendata.dwd.de/weather/nwp/icon/grib",
        rate_limit_seconds=0.0,
    )


def _icon_dataset(*, artifact_id: str, artifact_config: dict, frame_id: str) -> DatasetConfig:
    return _icon_dataset_for_artifacts(
        frame_id=frame_id,
        artifacts={artifact_id: icon_artifact_spec(artifact_id, artifact_config)},
        workload_artifacts=(artifact_id,),
    )


def _icon_dataset_for_artifacts(
    *,
    frame_id: str,
    artifacts: dict,
    workload_artifacts: tuple[str, ...],
) -> DatasetConfig:
    return DatasetConfig(
        id="icon",
        label="ICON",
        source=_icon_source(),
        workload=WorkloadConfig(frames=(frame_id,), artifacts=workload_artifacts),
        artifacts=artifacts,
        mode="forecast_cycle",
    )


@contextmanager
def _cached_icon_source_patches(root: Path):
    with (
        patch.dict(os.environ, {"ICON_SOURCE_MIN_BYTES": "1"}, clear=False),
        patch("weather_etl.sources.icon.dwd.default_etl_dir", return_value=root),
        patch(
            "weather_etl.sources.icon.dwd.make_runner",
            side_effect=AssertionError("regrid should be cached"),
        ),
    ):
        yield
