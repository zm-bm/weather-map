"""ICON DWD source acquisition adapter."""

from __future__ import annotations

import bz2
import os
import random
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path

from ..config.schema import SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL, ModelConfig
from ..proc import make_runner
from ..sources.gfs_layout import default_etl_dir, parse_cycle
from ..sources.prepared import PreparedSource
from ..stores.base import UriStore

ICON_PARAM_MATCH_KEY = "ICON_PARAM"
DEFAULT_ICON_SOURCE_WAIT_SECONDS = 2700.0
DEFAULT_ICON_RETRY_BASE_SECONDS = 10.0
DEFAULT_ICON_RETRY_MAX_SECONDS = 120.0
DEFAULT_ICON_SOURCE_MIN_BYTES = 1024
DEFAULT_ICON_REGRID_DESCRIPTION_FILE = "/opt/dwd-regrid/descriptions/icon/icon_description.txt"
DEFAULT_ICON_REGRID_WEIGHTS_FILE = "/opt/dwd-regrid/weights/icon/icon_weights.nc"
RETRYABLE_HTTP_CODES = {403, 404, 408, 409, 425, 429, 500, 502, 503, 504}


class IconSourceNotReady(RuntimeError):
    """Raised when DWD has not finished publishing a requested ICON input."""


def icon_dwd_filename(*, cycle: str, fhour: str, icon_param: str) -> str:
    """Return the DWD ICON GRIB2.bz2 filename for one parameter."""

    return f"icon_global_icosahedral_single-level_{cycle}_{fhour}_{icon_param.upper()}.grib2.bz2"


def icon_dwd_url(*, base_url: str, cycle: str, fhour: str, icon_param: str) -> str:
    """Return the DWD ICON download URL for one cycle/hour/parameter."""

    _, cycle_hour = parse_cycle(cycle)
    filename = icon_dwd_filename(cycle=cycle, fhour=fhour, icon_param=icon_param)
    return f"{base_url.rstrip('/')}/{cycle_hour}/{icon_param.lower()}/{filename}"


def required_icon_params(model: ModelConfig) -> tuple[str, ...]:
    """Return the unique ICON parameters required by the model workload."""

    params: set[str] = set()
    for product_id in model.workload.products:
        product = model.products.get(product_id)
        if product is None:
            raise SystemExit(f"Unknown ICON workload product: {product_id}")
        for component in product.components:
            icon_param = component.grib_match.get(ICON_PARAM_MATCH_KEY, "").strip().lower()
            if not icon_param:
                raise SystemExit(f"ICON product {product.id}.{component.id} missing {ICON_PARAM_MATCH_KEY}")
            params.add(icon_param)
    return tuple(sorted(params))


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be a number, got: {raw!r}") from exc
    return max(0.0, value)


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer, got: {raw!r}") from exc
    return max(0, value)


def _icon_source_wait_seconds() -> float:
    return _float_env("ICON_SOURCE_WAIT_SECONDS", DEFAULT_ICON_SOURCE_WAIT_SECONDS)


def _icon_source_min_bytes() -> int:
    return _int_env("ICON_SOURCE_MIN_BYTES", DEFAULT_ICON_SOURCE_MIN_BYTES)


def _retry_sleep_seconds(attempt: int) -> float:
    base = _float_env("ICON_SOURCE_RETRY_BASE_SECONDS", DEFAULT_ICON_RETRY_BASE_SECONDS)
    cap = _float_env("ICON_SOURCE_RETRY_MAX_SECONDS", DEFAULT_ICON_RETRY_MAX_SECONDS)
    delay = min(cap, base * (2 ** min(attempt, 6)))
    return delay + random.uniform(0.0, min(5.0, delay * 0.1))


def _download_if_needed(url: str, out_path: Path, *, wait_seconds: float | None = None) -> bool:
    min_bytes = _icon_source_min_bytes()
    if out_path.exists() and out_path.stat().st_size >= min_bytes:
        return False
    out_path.unlink(missing_ok=True)

    deadline = time.monotonic() + (_icon_source_wait_seconds() if wait_seconds is None else max(0.0, wait_seconds))
    attempt = 0
    while True:
        try:
            return _download_once(url=url, out_path=out_path, min_bytes=min_bytes)
        except IconSourceNotReady as exc:
            if time.monotonic() >= deadline:
                raise SystemExit(f"ICON DWD source not ready after waiting: {exc}") from None
            sleep_seconds = min(_retry_sleep_seconds(attempt), max(0.0, deadline - time.monotonic()))
            print(f"ICON source not ready; retrying in {sleep_seconds:.1f}s: {exc}", flush=True)
            time.sleep(sleep_seconds)
            attempt += 1


def _download_once(*, url: str, out_path: Path, min_bytes: int) -> bool:
    """Download one ICON object or raise a retryable readiness error."""

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    print(f"Downloading {url} -> {out_path}", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "weather-map-etl/1.0"})
    try:
        try:
            response_context = urllib.request.urlopen(request, timeout=60)
        except urllib.error.HTTPError as exc:
            if exc.code in RETRYABLE_HTTP_CODES:
                raise IconSourceNotReady(f"HTTP {exc.code} {exc.reason} for {url}") from None
            raise SystemExit(f"ICON DWD download failed: HTTP {exc.code} {exc.reason} for {url}") from None
        except urllib.error.URLError as exc:
            raise IconSourceNotReady(f"{exc.reason} for {url}") from None

        with response_context as response:
            status = int(getattr(response, "status", 200))
            if status in RETRYABLE_HTTP_CODES:
                raise IconSourceNotReady(f"HTTP {status} for {url}")
            if status != 200:
                raise SystemExit(f"ICON DWD download failed: HTTP {status} for {url}")
            with open(tmp_path, "wb") as handle:
                shutil.copyfileobj(response, handle)
        if tmp_path.stat().st_size < min_bytes:
            raise IconSourceNotReady(f"downloaded object is smaller than {min_bytes} bytes for {url}")
        tmp_path.replace(out_path)
        return True
    finally:
        tmp_path.unlink(missing_ok=True)


def _decompress_bz2_if_needed(src_path: Path, out_path: Path) -> bool:
    if out_path.exists():
        return False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    print(f"Decompressing {src_path} -> {out_path}", flush=True)
    try:
        try:
            with bz2.open(src_path, "rb") as source, open(tmp_path, "wb") as target:
                shutil.copyfileobj(source, target)
        except (EOFError, OSError, ValueError) as exc:
            src_path.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
            raise IconSourceNotReady(f"invalid or incomplete bzip2 payload at {src_path}: {exc}") from None
        tmp_path.replace(out_path)
        return True
    finally:
        tmp_path.unlink(missing_ok=True)


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
