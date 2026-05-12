"""ICON source acquisition adapter."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

from ..config.schema import SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL, ModelConfig
from ..proc import make_runner
from ..sources.icon_dwd import (
    ICON_PARAM_MATCH_KEY,
    IconSourceNotReady,
    _decompress_bz2_if_needed,
    _download_if_needed,
    _icon_source_wait_seconds,
    _retry_sleep_seconds,
    icon_dwd_filename,
    icon_dwd_url,
    required_icon_params,
)
from ..sources.prepared import PreparedSource
from ..stores.base import UriStore
from ..uris import default_etl_dir

DEFAULT_ICON_REGRID_DESCRIPTION_FILE = "/opt/dwd-regrid/descriptions/icon/icon_description.txt"
DEFAULT_ICON_REGRID_WEIGHTS_FILE = "/opt/dwd-regrid/weights/icon/icon_weights.nc"


def _regrid_description_file() -> Path:
    return Path(os.environ.get("ICON_REGRID_DESCRIPTION_FILE", DEFAULT_ICON_REGRID_DESCRIPTION_FILE))


def _regrid_weights_file() -> Path:
    return Path(os.environ.get("ICON_REGRID_WEIGHTS_FILE", DEFAULT_ICON_REGRID_WEIGHTS_FILE))


def _regrid_if_needed(
    *,
    input_path: Path,
    output_path: Path,
    description_file: Path | str | None = None,
    weights_file: Path | str | None = None,
) -> bool:
    if output_path.exists():
        return False

    cdo_bin = shutil.which("cdo")
    if cdo_bin is None:
        raise SystemExit("ICON regridding requires cdo, but 'cdo' was not found on PATH")

    description_path = Path(description_file) if description_file is not None else _regrid_description_file()
    weights_path = Path(weights_file) if weights_file is not None else _regrid_weights_file()
    if not description_path.is_file():
        raise SystemExit(f"ICON regrid description file not found: {description_path}")
    if not weights_path.is_file():
        raise SystemExit(f"ICON regrid weights file not found: {weights_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    tmp_path.unlink(missing_ok=True)
    run = make_runner()
    try:
        run(
            [
                cdo_bin,
                "-f",
                "grb2",
                f"remap,{description_path.as_posix()},{weights_path.as_posix()}",
                input_path.as_posix(),
                tmp_path.as_posix(),
            ]
        )
        if not tmp_path.exists():
            raise SystemExit(f"ICON regrid command completed but did not write expected output: {tmp_path}")
        tmp_path.replace(output_path)
    finally:
        tmp_path.unlink(missing_ok=True)
    return True


def _prepare_icon_param(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    icon_param: str,
) -> tuple[Path, bool]:
    """Download, decompress, and regrid one ICON parameter if needed."""

    if model.source.icon_dwd is None:
        raise SystemExit(f"Model {model.id!r} is not configured for ICON DWD acquisition")

    source = model.source.icon_dwd
    cache_dir = default_etl_dir() / "cache" / "grib" / model.id / cycle / fhour
    filename = icon_dwd_filename(cycle=cycle, fhour=fhour, icon_param=icon_param)
    compressed_path = cache_dir / filename
    decompressed_path = cache_dir / filename.removesuffix(".bz2")
    regridded_path = cache_dir / f"{icon_param.lower()}.regridded.grib2"

    url = icon_dwd_url(
        base_url=source.base_url,
        cycle=cycle,
        fhour=fhour,
        icon_param=icon_param,
    )
    deadline = time.monotonic() + _icon_source_wait_seconds()
    attempt = 0
    downloaded_any = False
    while True:
        remaining = max(0.0, deadline - time.monotonic())
        downloaded = _download_if_needed(url, compressed_path, wait_seconds=remaining)
        downloaded_any = downloaded_any or downloaded
        try:
            _decompress_bz2_if_needed(compressed_path, decompressed_path)
        except IconSourceNotReady as exc:
            if time.monotonic() >= deadline:
                raise SystemExit(f"ICON DWD source not ready after waiting: {exc}") from None
            decompressed_path.unlink(missing_ok=True)
            regridded_path.unlink(missing_ok=True)
            sleep_seconds = min(_retry_sleep_seconds(attempt), max(0.0, deadline - time.monotonic()))
            print(f"ICON compressed source not ready; retrying in {sleep_seconds:.1f}s: {exc}", flush=True)
            time.sleep(sleep_seconds)
            attempt += 1
            continue

        _regrid_if_needed(
            input_path=decompressed_path,
            output_path=regridded_path,
        )
        return regridded_path, downloaded_any


def _acquire_icon_dwd_source(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri_override: str | None,
) -> PreparedSource:
    """Acquire the prepared GRIB collection for one ICON cycle/hour."""

    if model.source.type != SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL or model.source.icon_dwd is None:
        raise SystemExit(f"Model {model.id!r} is not configured for ICON DWD acquisition")
    if source_uri_override is not None and source_uri_override.strip():
        raise SystemExit(f"Model {model.id!r} uses ICON DWD acquisition and does not accept --source-uri")

    grib_paths: dict[str, Path] = {}
    rate_limit_seconds = model.source.icon_dwd.rate_limit_seconds
    for icon_param in required_icon_params(model):
        grib_path, downloaded = _prepare_icon_param(
            model=model,
            cycle=cycle,
            fhour=fhour,
            icon_param=icon_param,
        )
        grib_paths[icon_param] = grib_path
        if downloaded and rate_limit_seconds > 0:
            time.sleep(rate_limit_seconds)

    return PreparedSource.grib_collection(
        uri=f"icon-dwd://{model.id}/{cycle}/{fhour}",
        grib_paths=grib_paths,
        grid_id=model.source.grid_id,
        selector_key=ICON_PARAM_MATCH_KEY,
    )


def acquire_prepared_source(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri_override: str | None,
    workdir: Path,
    store: UriStore,
) -> PreparedSource:
    """Acquire a prepared source for an ICON DWD model."""

    del workdir, store
    if model.source.type == SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
        return _acquire_icon_dwd_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri_override,
        )

    raise SystemExit(f"Unsupported ICON model source type for {model.id!r}: {model.source.type!r}")
