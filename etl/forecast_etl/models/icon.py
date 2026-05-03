"""ICON DWD source acquisition adapter."""

from __future__ import annotations

import bz2
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


def icon_dwd_filename(*, cycle: str, fhour: str, icon_param: str) -> str:
    return f"icon_global_icosahedral_single-level_{cycle}_{fhour}_{icon_param.upper()}.grib2.bz2"


def icon_dwd_url(*, base_url: str, cycle: str, fhour: str, icon_param: str) -> str:
    _, cycle_hour = parse_cycle(cycle)
    filename = icon_dwd_filename(cycle=cycle, fhour=fhour, icon_param=icon_param)
    return f"{base_url.rstrip('/')}/{cycle_hour}/{icon_param.lower()}/{filename}"


def required_icon_params(model: ModelConfig) -> tuple[str, ...]:
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


def _download_if_needed(url: str, out_path: Path) -> bool:
    if out_path.exists():
        return False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    print(f"Downloading {url} -> {out_path}", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "weather-map-etl/1.0"})
    try:
        try:
            response_context = urllib.request.urlopen(request)
        except urllib.error.HTTPError as exc:
            raise SystemExit(f"ICON DWD download failed: HTTP {exc.code} {exc.reason} for {url}") from None
        except urllib.error.URLError as exc:
            raise SystemExit(f"ICON DWD download failed: {exc.reason} for {url}") from None

        with response_context as response:
            status = int(getattr(response, "status", 200))
            if status != 200:
                raise SystemExit(f"ICON DWD download failed: HTTP {status} for {url}")
            with open(tmp_path, "wb") as handle:
                shutil.copyfileobj(response, handle)
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
        with bz2.open(src_path, "rb") as source, open(tmp_path, "wb") as target:
            shutil.copyfileobj(source, target)
        tmp_path.replace(out_path)
        return True
    finally:
        tmp_path.unlink(missing_ok=True)


def _regrid_if_needed(*, input_path: Path, output_path: Path, regrid_image: str) -> bool:
    if output_path.exists():
        return False

    docker_bin = shutil.which("docker")
    if docker_bin is None:
        raise SystemExit("ICON regridding requires Docker, but 'docker' was not found on PATH")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    run = make_runner()
    run(
        [
            docker_bin,
            "run",
            "--rm",
            "--volume",
            f"{input_path.parent.resolve().as_posix()}:/work",
            "--env",
            f"INPUT_FILE=/work/{input_path.name}",
            "--env",
            f"OUTPUT_FILE=/work/{output_path.name}",
            regrid_image,
        ]
    )
    if not output_path.exists():
        raise SystemExit(f"ICON regrid command completed but did not write expected output: {output_path}")
    return True


def _prepare_icon_param(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    icon_param: str,
) -> tuple[Path, bool]:
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
    downloaded = _download_if_needed(url, compressed_path)
    _decompress_bz2_if_needed(compressed_path, decompressed_path)
    _regrid_if_needed(
        input_path=decompressed_path,
        output_path=regridded_path,
        regrid_image=source.regrid_image,
    )
    return regridded_path, downloaded


def _acquire_icon_dwd_source(
    *,
    model: ModelConfig,
    cycle: str,
    fhour: str,
    source_uri_override: str | None,
) -> PreparedSource:
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
    del workdir, store
    if model.source.type == SOURCE_TYPE_ICON_DWD_ICOSAHEDRAL:
        return _acquire_icon_dwd_source(
            model=model,
            cycle=cycle,
            fhour=fhour,
            source_uri_override=source_uri_override,
        )

    raise SystemExit(f"Unsupported ICON model source type for {model.id!r}: {model.source.type!r}")
