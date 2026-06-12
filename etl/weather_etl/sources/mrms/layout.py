"""MRMS AWS Open Data S3 key and URI conventions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import quote

from ...core.frames import validate_frame_id
from .products import MRMS_PRODUCTS, MRMS_PRODUCTS_BY_NAME, MrmsProduct

DEFAULT_MRMS_AWS_BUCKET = "noaa-mrms-pds"
DEFAULT_MRMS_AWS_PREFIX = "CONUS"
_FRAME_ID_RE = re.compile(r"^\d{14}$")


@dataclass(frozen=True)
class MrmsS3Key:
    """Parsed MRMS S3 object key for one product timestamp."""

    area: str
    product: MrmsProduct
    frame_id: str
    filename: str


def mrms_product_filename(*, product: MrmsProduct, frame_id: str) -> str:
    return f"{product.filename_prefix}_{product.level}_{product_timestamp_from_frame_id(frame_id)}.grib2.gz"


def product_timestamp_from_frame_id(frame_id: str) -> str:
    value = validate_frame_id(frame_id)
    if _FRAME_ID_RE.fullmatch(value) is None:
        raise SystemExit(f"MRMS frame id must be YYYYMMDDHHMMSS, got: {frame_id!r}")
    return f"{value[:8]}-{value[8:]}"


def mrms_product_dir(*, product: MrmsProduct) -> str:
    return f"{product.product}_{product.level}"


def mrms_s3_product_key(
    *,
    product: MrmsProduct,
    frame_id: str,
    prefix: str = DEFAULT_MRMS_AWS_PREFIX,
) -> str:
    product_timestamp = product_timestamp_from_frame_id(frame_id)
    date_part = product_timestamp.split("-", 1)[0]
    return "/".join([
        prefix.strip("/"),
        mrms_product_dir(product=product),
        date_part,
        mrms_product_filename(product=product, frame_id=frame_id),
    ])


def mrms_s3_product_uri(
    *,
    bucket: str = DEFAULT_MRMS_AWS_BUCKET,
    product: MrmsProduct,
    frame_id: str,
    prefix: str = DEFAULT_MRMS_AWS_PREFIX,
) -> str:
    return f"s3://{bucket.strip('/')}/{mrms_s3_product_key(product=product, frame_id=frame_id, prefix=prefix)}"


def mrms_s3_collection_uri(
    *,
    bucket: str = DEFAULT_MRMS_AWS_BUCKET,
    prefix: str = DEFAULT_MRMS_AWS_PREFIX,
) -> str:
    return f"s3://{bucket.strip('/')}/{prefix.strip('/')}"


def mrms_product_uri_from_collection(
    *,
    collection_uri: str,
    product: MrmsProduct,
    frame_id: str,
) -> str:
    root = collection_uri.rstrip("/")
    product_timestamp = product_timestamp_from_frame_id(frame_id)
    date_part = product_timestamp.split("-", 1)[0]
    return "/".join([
        root,
        quote(mrms_product_dir(product=product)),
        date_part,
        quote(mrms_product_filename(product=product, frame_id=frame_id)),
    ])


def parse_mrms_s3_key(key: str, *, expected_prefix: str = DEFAULT_MRMS_AWS_PREFIX) -> MrmsS3Key | None:
    prefix = expected_prefix.strip("/")
    pattern = re.compile(
        rf"^{re.escape(prefix)}/([^/]+)/(\d{{8}})/([^/]+\.grib2\.gz)$"
    )
    matched = pattern.match(key.strip())
    if matched is None:
        return None

    product_dir, date_part, filename = matched.groups()
    product = _product_from_dir(product_dir)
    if product is None:
        return None

    filename_pattern = re.compile(
        rf"^{re.escape(product.filename_prefix)}_{re.escape(product.level)}_(\d{{8}})-(\d{{6}})\.grib2\.gz$"
    )
    filename_match = filename_pattern.match(filename)
    if filename_match is None:
        return None

    timestamp_date, timestamp_time = filename_match.groups()
    if timestamp_date != date_part:
        return None

    return MrmsS3Key(
        area=prefix,
        product=product,
        frame_id=f"{timestamp_date}{timestamp_time}",
        filename=filename,
    )


def _product_from_dir(product_dir: str) -> MrmsProduct | None:
    for product in MRMS_PRODUCTS:
        if product_dir == mrms_product_dir(product=product):
            return product
    return MRMS_PRODUCTS_BY_NAME.get(product_dir.rsplit("_", 1)[0])
