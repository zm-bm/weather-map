"""DWD ICON source naming, readiness, and download helpers."""

from __future__ import annotations

import bz2
import os
import random
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path

from ..config.resolved import ModelConfig
from ..cycles import parse_cycle
from ..derivations import (
    ICON_AVERAGE_RATE_DERIVATION_TYPES,
    ICON_WEATHER_CODE_DERIVATION_TYPES,
    icon_derivation_input_params,
    icon_param_from_grib_match,
)

DEFAULT_ICON_SOURCE_WAIT_SECONDS = 2700.0
DEFAULT_ICON_RETRY_BASE_SECONDS = 10.0
DEFAULT_ICON_RETRY_MAX_SECONDS = 120.0
DEFAULT_ICON_SOURCE_MIN_BYTES = 1024
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
    for artifact_id in model.workload.artifacts:
        artifact = model.artifacts.get(artifact_id)
        if artifact is None:
            raise SystemExit(f"Unknown ICON workload artifact: {artifact_id}")
        for component in artifact.components:
            if component.grib_match is None:
                continue
            params.add(
                icon_param_from_grib_match(
                    artifact_id=artifact_id,
                    selector_id=getattr(component, "id", None),
                    grib_match=component.grib_match,
                )
            )
        derivation = getattr(artifact, "derivation", None)
        if derivation is not None:
            params.update(icon_derivation_input_params(artifact_id=artifact_id, derivation=derivation))
    return tuple(sorted(params))


def required_previous_icon_params(model: ModelConfig) -> tuple[str, ...]:
    """Return ICON parameters needed from the previous forecast hour."""

    params: set[str] = set()
    for artifact_id in model.workload.artifacts:
        artifact = model.artifacts.get(artifact_id)
        if artifact is None:
            raise SystemExit(f"Unknown ICON workload artifact: {artifact_id}")
        derivation = getattr(artifact, "derivation", None)
        if derivation is None:
            continue
        if derivation.type in ICON_AVERAGE_RATE_DERIVATION_TYPES:
            params.update(icon_derivation_input_params(artifact_id=artifact_id, derivation=derivation))
            continue
        if derivation.type in ICON_WEATHER_CODE_DERIVATION_TYPES:
            continue
        raise SystemExit(f"Unsupported ICON derivation for {artifact_id}: {derivation.type!r}")
    return tuple(sorted(params))


def previous_icon_fhour(fhour: str) -> str | None:
    """Return the previous forecast-hour id, or None for zero-baseline hours."""

    if len(fhour) != 3 or not fhour.isdigit():
        raise SystemExit(f"ICON forecast hour must be a 3-digit string, got {fhour!r}")
    hour = int(fhour)
    if hour <= 1:
        return None
    return f"{hour - 1:03d}"


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
