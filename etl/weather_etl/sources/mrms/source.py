"""MRMS AWS Open Data S3 GRIB2 source acquisition adapter."""

from __future__ import annotations

import gzip
import re
import shutil
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from ...config.pipeline import ArtifactDerivationSpec, DatasetConfig
from ...config.sources import MRMS_AWS_S3_SOURCE_TYPE
from ...core.frames import validate_frame_id
from ...core.timestamps import isoformat_utc
from ...processing.proc import RunFn
from ...storage.base import UriStore
from ...storage.uris import INPUT_RESOURCE_SCHEMES, normalize_resource_uri
from ..prepared_grib import PreparedGribSource
from .config import MrmsAwsS3SourceSettings, parse_mrms_aws_s3_source
from .layout import (
    mrms_product_uri_from_collection,
    parse_mrms_s3_key,
)
from .products import MRMS_PRODUCT_SELECTOR_KEY, MRMS_PRODUCTS, MRMS_PRODUCTS_BY_NAME, MrmsProduct

MRMS_DEFAULT_LOOKBACK_MINUTES = 120
_FRAME_ID_RE = re.compile(r"^\d{14}$")
_DISCOVERY_MIN_BACKSCAN_MINUTES = 24 * 60


@dataclass(frozen=True)
class MrmsProductFile:
    """One timestamped MRMS S3 product object."""

    product: MrmsProduct
    timestamp: datetime
    frame_id: str
    filename: str
    key: str
    uri: str


def discover_recent_frame_ids(
    *,
    dataset: DatasetConfig,
    lookback_minutes: int = MRMS_DEFAULT_LOOKBACK_MINUTES,
    store: UriStore | None = None,
    now: datetime | None = None,
) -> tuple[str, ...]:
    """Return common MRMS frame ids in the latest source-relative lookback window."""

    if lookback_minutes <= 0:
        raise SystemExit("MRMS lookback window must be positive")
    if store is None:
        raise SystemExit("MRMS S3 discovery requires a URI store")

    source = _mrms_source(dataset)
    files_by_product = discover_product_files(
        source=source,
        store=store,
        lookback_minutes=lookback_minutes,
        now=now,
    )
    common = common_product_files(files_by_product)
    if not common:
        raise SystemExit("MRMS S3 source did not advertise any common timestamps for all configured products")

    end_dt = common[-1].timestamp
    start_dt = end_dt - timedelta(minutes=lookback_minutes)
    frames = tuple(entry.frame_id for entry in common if start_dt <= entry.timestamp <= end_dt)
    if not frames:
        raise SystemExit(
            "MRMS lookback window contains no timestamps present for both products: "
            f"start={isoformat_utc(start_dt)} end={isoformat_utc(end_dt)}"
        )
    return frames


def validate_mrms_frame_ids(frames: Iterable[str]) -> tuple[str, ...]:
    """Validate explicit MRMS timestamp frame ids."""

    resolved = tuple(datetime_from_frame_id(str(frame_id)).strftime("%Y%m%d%H%M%S") for frame_id in frames)
    if not resolved:
        raise SystemExit("MRMS explicit frame set must not be empty")
    return resolved


def frame_valid_times(frames: Iterable[str]) -> dict[str, str]:
    """Return manifest valid_at timestamps for MRMS timestamp frame ids."""

    return {
        frame_id: isoformat_utc(datetime_from_frame_id(frame_id))
        for frame_id in (validate_frame_id(frame) for frame in frames)
    }


def datetime_from_frame_id(frame_id: str) -> datetime:
    """Parse the MRMS YYYYMMDDHHMMSS frame id as UTC."""

    value = validate_frame_id(frame_id)
    if _FRAME_ID_RE.fullmatch(value) is None:
        raise SystemExit(f"MRMS frame id must be YYYYMMDDHHMMSS, got: {frame_id!r}")
    return datetime.strptime(value, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)


def discover_product_files(
    *,
    source: MrmsAwsS3SourceSettings,
    store: UriStore,
    lookback_minutes: int,
    now: datetime | None = None,
) -> dict[str, dict[str, MrmsProductFile]]:
    """List timestamped S3 objects for each configured MRMS product."""

    dates = _discovery_dates(now=now, lookback_minutes=lookback_minutes)
    return {
        product.product: _discover_product_files_for_dates(
            source=source,
            store=store,
            product=product,
            dates=dates,
        )
        for product in MRMS_PRODUCTS
    }


def common_product_files(
    files_by_product: Mapping[str, Mapping[str, MrmsProductFile]],
) -> tuple[MrmsProductFile, ...]:
    """Return representative files for timestamps present in every product."""

    if not files_by_product:
        return ()
    common_frame_ids: set[str] | None = None
    for files in files_by_product.values():
        frame_ids = set(files)
        common_frame_ids = frame_ids if common_frame_ids is None else common_frame_ids & frame_ids
    if not common_frame_ids:
        return ()

    representative_product = MRMS_PRODUCTS[0].product
    representatives = files_by_product[representative_product]
    return tuple(sorted((representatives[frame_id] for frame_id in common_frame_ids), key=lambda item: item.timestamp))


def acquire_prepared_source(
    *,
    dataset: DatasetConfig,
    cycle: str,
    frame_id: str,
    source_uri_override: str | None,
    artifact_ids: Iterable[str],
    workdir: Path,
    store: UriStore,
    run: RunFn | None = None,
) -> PreparedGribSource:
    """Acquire a prepared MRMS GRIB collection for one observed timestamp."""

    del cycle, run

    source = _mrms_source(dataset)
    frame_id = validate_frame_id(frame_id)
    collection_uri = _source_collection_uri(source_uri_override) or source.collection_uri
    grib_paths: dict[str, Path] = {}
    copied_any = False
    for product in required_mrms_products(dataset=dataset, artifact_ids=artifact_ids):
        grib_path, copied = _prepare_collection_product(
            collection_uri=collection_uri,
            store=store,
            workdir=workdir,
            frame_id=frame_id,
            product=product,
        )
        copied_any = copied_any or copied
        grib_paths[product.product] = grib_path

    if copied_any:
        print(f"Prepared MRMS timestamp {frame_id}", flush=True)

    return PreparedGribSource.grib_collection(
        uri=f"mrms-s3://{frame_id}",
        grib_paths=grib_paths,
        grid_id=source.grid_id,
        selector_key=MRMS_PRODUCT_SELECTOR_KEY,
    )


def required_mrms_products(*, dataset: DatasetConfig, artifact_ids: Iterable[str]) -> tuple[MrmsProduct, ...]:
    """Return MRMS products required by selected artifact component selectors."""

    required: list[MrmsProduct] = []
    seen: set[str] = set()
    for artifact_id in artifact_ids:
        artifact = dataset.artifacts.get(str(artifact_id))
        if artifact is None:
            raise SystemExit(f"Unknown artifact in MRMS workload: {artifact_id}")
        for grib_match in _artifact_grib_matches(artifact.derivation, artifact.component_grib_matches):
            raw_product = grib_match.get(MRMS_PRODUCT_SELECTOR_KEY)
            product_name = raw_product.strip() if isinstance(raw_product, str) else ""
            product = MRMS_PRODUCTS_BY_NAME.get(product_name)
            if product is None:
                raise SystemExit(
                    f"MRMS artifact {artifact.id!r} references unsupported {MRMS_PRODUCT_SELECTOR_KEY}: "
                    f"{raw_product!r}"
                )
            if product.product not in seen:
                seen.add(product.product)
                required.append(product)
    return tuple(required)


def _artifact_grib_matches(
    derivation: ArtifactDerivationSpec | None,
    component_grib_matches: Mapping[str, Mapping[str, str] | None],
) -> tuple[Mapping[str, str], ...]:
    if derivation is not None:
        return tuple(input_item.grib_match for input_item in derivation.inputs)
    return tuple(match for match in component_grib_matches.values() if match is not None)


def _mrms_source(dataset: DatasetConfig) -> MrmsAwsS3SourceSettings:
    if dataset.source.type != MRMS_AWS_S3_SOURCE_TYPE:
        raise SystemExit(f"Dataset {dataset.id!r} is not configured for MRMS AWS S3 acquisition")
    return parse_mrms_aws_s3_source(dataset.source)


def _discover_product_files_for_dates(
    *,
    source: MrmsAwsS3SourceSettings,
    store: UriStore,
    product: MrmsProduct,
    dates: tuple[str, ...],
) -> dict[str, MrmsProductFile]:
    by_frame: dict[str, MrmsProductFile] = {}
    for date_part in dates:
        prefix_uri = _product_date_prefix_uri(source=source, product=product, date_part=date_part)
        for obj in store.list_objects(prefix_uri=prefix_uri):
            product_file = _product_file_from_uri(source=source, product=product, uri=obj.uri)
            if product_file is not None:
                by_frame[product_file.frame_id] = product_file
    return by_frame


def _product_file_from_uri(
    *,
    source: MrmsAwsS3SourceSettings,
    product: MrmsProduct,
    uri: str,
) -> MrmsProductFile | None:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or parsed.netloc != source.normalized_bucket:
        return None
    key = unquote(parsed.path.lstrip("/"))
    parsed_key = parse_mrms_s3_key(key, expected_prefix=source.normalized_prefix)
    if parsed_key is None or parsed_key.product.product != product.product:
        return None
    timestamp = datetime_from_frame_id(parsed_key.frame_id)
    return MrmsProductFile(
        product=product,
        timestamp=timestamp,
        frame_id=parsed_key.frame_id,
        filename=parsed_key.filename,
        key=key,
        uri=uri,
    )


def _discovery_dates(*, now: datetime | None, lookback_minutes: int) -> tuple[str, ...]:
    effective_now = now or datetime.now(timezone.utc)
    if effective_now.tzinfo is None:
        effective_now = effective_now.replace(tzinfo=timezone.utc)
    effective_now = effective_now.astimezone(timezone.utc)
    scan_minutes = max(lookback_minutes, _DISCOVERY_MIN_BACKSCAN_MINUTES)
    start_date = (effective_now - timedelta(minutes=scan_minutes)).date()
    end_date = effective_now.date()
    days: list[str] = []
    current = start_date
    while current <= end_date:
        days.append(current.strftime("%Y%m%d"))
        current = date.fromordinal(current.toordinal() + 1)
    return tuple(days)


def _product_date_prefix_uri(
    *,
    source: MrmsAwsS3SourceSettings,
    product: MrmsProduct,
    date_part: str,
) -> str:
    return "/".join([
        source.collection_uri,
        f"{product.product}_{product.level}",
        date_part,
        "",
    ])


def _source_collection_uri(source_uri_override: str | None) -> str | None:
    if source_uri_override is None or not source_uri_override.strip():
        return None
    return normalize_resource_uri(source_uri_override, allowed_schemes=INPUT_RESOURCE_SCHEMES)


def _prepare_collection_product(
    *,
    collection_uri: str,
    store: UriStore,
    workdir: Path,
    frame_id: str,
    product: MrmsProduct,
) -> tuple[Path, bool]:
    grib_dir = workdir / "mrms" / frame_id
    grib_path = grib_dir / product.cache_filename
    if grib_path.exists() and grib_path.stat().st_size > 0:
        return grib_path, False

    compressed_path = grib_dir / f"{product.cache_filename}.gz"
    copied = _copy_uri_if_needed(
        uri=mrms_product_uri_from_collection(
            collection_uri=collection_uri,
            product=product,
            frame_id=frame_id,
        ),
        store=store,
        out_path=compressed_path,
    )
    _decompress_gzip_if_needed(src_path=compressed_path, out_path=grib_path)
    if not grib_path.exists():
        raise SystemExit(f"Missing MRMS GRIB after copy/decompress attempt: {grib_path}")
    return grib_path, copied


def _copy_uri_if_needed(*, uri: str, store: UriStore, out_path: Path) -> bool:
    if out_path.exists() and out_path.stat().st_size > 0:
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Copying {uri} -> {out_path}", flush=True)
    try:
        store.get_to_file(uri=uri, dst=out_path)
    except FileNotFoundError as exc:
        raise SystemExit(f"MRMS source object not found: {uri}") from exc
    if out_path.stat().st_size <= 0:
        out_path.unlink(missing_ok=True)
        raise SystemExit(f"MRMS source object copied an empty payload: {uri}")
    return True


def _decompress_gzip_if_needed(*, src_path: Path, out_path: Path) -> bool:
    if out_path.exists() and out_path.stat().st_size > 0:
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    print(f"Decompressing {src_path} -> {out_path}", flush=True)
    try:
        try:
            with gzip.open(src_path, "rb") as source, open(tmp_path, "wb") as target:
                shutil.copyfileobj(source, target)
        except (EOFError, OSError, ValueError) as exc:
            src_path.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
            raise SystemExit(f"Invalid or incomplete MRMS gzip payload at {src_path}: {exc}") from None
        if tmp_path.stat().st_size <= 0:
            raise SystemExit(f"MRMS gzip payload decompressed to an empty GRIB: {src_path}")
        tmp_path.replace(out_path)
        return True
    finally:
        tmp_path.unlink(missing_ok=True)
