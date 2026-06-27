from __future__ import annotations

import gzip
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.sources.mrms.config import parse_mrms_aws_s3_source
from weather_etl.sources.mrms.layout import (
    mrms_product_uri_from_collection,
    mrms_s3_collection_uri,
    mrms_s3_product_key,
    parse_mrms_s3_key,
)
from weather_etl.sources.mrms.products import MRMS_COMPOSITE_REFLECTIVITY, MRMS_PRODUCT_SELECTOR_KEY, MRMS_PRODUCTS
from weather_etl.sources.mrms.source import (
    acquire_prepared_source,
    discover_recent_frame_ids,
    validate_mrms_frame_ids,
)
from weather_etl.storage.base import UriObject, UriStore, UriWriteMetadata
from weather_etl.storage.local import LocalFSStore


def _mrms_dataset():
    return parse_pipeline_config(_raw_mrms_pipeline()).dataset("mrms")


def _raw_mrms_pipeline() -> dict[str, Any]:
    return {
        "version": 3,
        "artifact_catalog": {
            "observed_radar_composite_reflectivity": _artifact_catalog_entry("MergedReflectivityQCComposite"),
        },
        "datasets": {
            "mrms": {
                "label": "MRMS",
                "source": {
                    "type": "mrms_aws_s3",
                    "grid_id": "mrms_conus_0p01",
                    "bucket": "noaa-mrms-pds",
                    "prefix": "CONUS",
                },
                "workload": {
                    "frame_start": 0,
                    "frame_end": 0,
                },
                "lifecycle": {
                    "type": "rolling_observed",
                    "display_window_minutes": 120,
                    "publish_scan_minutes": 180,
                },
                "artifacts": {
                    "observed_radar_composite_reflectivity": {
                        "components": [{
                            "id": "value",
                            "grib_match": {
                                "MRMS_PRODUCT": "MergedReflectivityQCComposite",
                                "GRIB_ELEMENT": "MergedReflectivityQCComposite",
                            },
                        }],
                    },
                },
            },
        },
    }


def _artifact_catalog_entry(parameter: str) -> dict:
    return {
        "kind": "scalar",
        "parameter": parameter,
        "level": "radar",
        "units": "dBZ",
        "source_transform": "identity",
        "encoding": {
            "id": f"{parameter}_i8_0p5dbz_v1",
            "format": "linear-i8-v1",
            "dtype": "int8",
            "byte_order": "none",
            "scale": 0.5,
            "offset": 31.5,
            "nodata": -128,
            "finite_value_range": {"min": 0, "max": 75},
        },
        "components": [{"id": "value"}],
    }


def test_mrms_source_config_parses_s3_bucket_and_prefix() -> None:
    source = parse_mrms_aws_s3_source(_mrms_dataset().source)

    assert source.type == "mrms_aws_s3"
    assert source.grid_id == "mrms_conus_0p01"
    assert source.normalized_bucket == "noaa-mrms-pds"
    assert source.normalized_prefix == "CONUS"
    assert source.collection_uri == "s3://noaa-mrms-pds/CONUS"


def test_discover_recent_frame_ids_defaults_to_latest_common_previous_120_minutes() -> None:
    store = _FakeUriStore(_mrms_objects({
        "MergedReflectivityQCComposite": (
            "20260610-225800",
            "20260610-235800",
            "20260611-000000",
            "20260611-010000",
        ),
    }))

    frames = discover_recent_frame_ids(
        dataset=_mrms_dataset(),
        store=store,
        now=datetime(2026, 6, 11, 1, 5, tzinfo=timezone.utc),
    )

    assert frames == ("20260610235800", "20260611000000", "20260611010000")


def test_discover_recent_frame_ids_uses_configured_lookback_from_latest_source_time() -> None:
    store = _FakeUriStore(_mrms_objects({
        "MergedReflectivityQCComposite": (
            "20260611-000000",
            "20260611-003000",
            "20260611-010000",
        ),
    }))

    frames = discover_recent_frame_ids(
        dataset=_mrms_dataset(),
        lookback_minutes=45,
        store=store,
        now=datetime(2026, 6, 11, 1, 5, tzinfo=timezone.utc),
    )

    assert frames == ("20260611003000", "20260611010000")


def test_validate_mrms_frame_ids_accepts_explicit_timestamp_frames() -> None:
    assert validate_mrms_frame_ids(("20260611000000", "20260611000200")) == (
        "20260611000000",
        "20260611000200",
    )


def test_mrms_s3_layout_builds_and_parses_product_keys() -> None:
    product = MRMS_COMPOSITE_REFLECTIVITY
    key = mrms_s3_product_key(product=product, frame_id="20260611053640")

    assert key == (
        "CONUS/MergedReflectivityQCComposite_00.50/20260611/"
        "MRMS_MergedReflectivityQCComposite_00.50_20260611-053640.grib2.gz"
    )
    parsed = parse_mrms_s3_key(key)
    assert parsed is not None
    assert parsed.product is product
    assert parsed.frame_id == "20260611053640"
    assert (
        mrms_product_uri_from_collection(
            collection_uri=mrms_s3_collection_uri(),
            product=product,
            frame_id="20260611053640",
        )
        == f"s3://noaa-mrms-pds/{key}"
    )


def test_parse_mrms_s3_key_rejects_removed_product_key() -> None:
    removed_product = "Reflectivity" + "AtLowestAltitude"
    key = (
        f"CONUS/{removed_product}_00.50/20260611/"
        f"MRMS_{removed_product}_00.50_20260611-053640.grib2.gz"
    )

    assert parse_mrms_s3_key(key) is None


def test_acquire_prepared_source_copies_from_configured_s3_decompresses_and_reuses_cache(
    tmp_path: Path,
) -> None:
    dataset = _mrms_dataset()
    frame_id = "20260611053640"
    store = _FakeUriStore(_mrms_objects(
        {
            "MergedReflectivityQCComposite": ("20260611-053640",),
        },
        payload_prefix="s3-payload",
    ))

    source = acquire_prepared_source(
        dataset=dataset,
        cycle="2026061105",
        frame_id=frame_id,
        source_uri_override=None,
        artifact_ids=("observed_radar_composite_reflectivity",),
        workdir=tmp_path,
        store=store,
    )

    assert source.uri == f"mrms-s3://{frame_id}"
    assert source.grid_id == "mrms_conus_0p01"
    assert sorted(source.grib_paths) == ["mergedreflectivityqccomposite"]
    assert (
        source.component_grib_path(
            artifact_id="observed_radar_composite_reflectivity",
            component_id="value",
            grib_match={MRMS_PRODUCT_SELECTOR_KEY: "MergedReflectivityQCComposite"},
        ).read_bytes()
        == b"s3-payload:MergedReflectivityQCComposite"
    )

    acquire_prepared_source(
        dataset=dataset,
        cycle="2026061105",
        frame_id=frame_id,
        source_uri_override=None,
        artifact_ids=("observed_radar_composite_reflectivity",),
        workdir=tmp_path,
        store=store,
    )

    assert store.get_to_file_calls == 1


def test_acquire_prepared_source_fails_when_s3_product_is_missing(tmp_path: Path) -> None:
    store = _FakeUriStore(_mrms_objects({}))

    with pytest.raises(SystemExit, match="MRMS source object not found"):
        acquire_prepared_source(
            dataset=_mrms_dataset(),
            cycle="2026061105",
            frame_id="20260611053640",
            source_uri_override=None,
            artifact_ids=("observed_radar_composite_reflectivity",),
            workdir=tmp_path,
            store=store,
        )


def test_acquire_prepared_source_rejects_removed_mrms_product(tmp_path: Path) -> None:
    removed_product = "Reflectivity" + "AtLowestAltitude"
    pipeline = _raw_mrms_pipeline()
    pipeline["artifact_catalog"]["removed_radar_product"] = _artifact_catalog_entry(removed_product)
    pipeline["datasets"]["mrms"]["artifacts"]["removed_radar_product"] = {
        "components": [{
            "id": "value",
            "grib_match": {
                "MRMS_PRODUCT": removed_product,
                "GRIB_ELEMENT": removed_product,
            },
        }],
    }
    dataset = parse_pipeline_config(pipeline).dataset("mrms")

    with pytest.raises(SystemExit, match="references unsupported MRMS_PRODUCT"):
        acquire_prepared_source(
            dataset=dataset,
            cycle="2026061105",
            frame_id="20260611053640",
            source_uri_override=None,
            artifact_ids=("removed_radar_product",),
            workdir=tmp_path,
            store=_FakeUriStore({}),
        )


def test_acquire_prepared_source_accepts_collection_override(tmp_path: Path) -> None:
    dataset = _mrms_dataset()
    frame_id = "20260611053640"
    collection_root = tmp_path / "CONUS"
    source_uri = mrms_product_uri_from_collection(
        collection_uri=collection_root.as_uri(),
        product=MRMS_COMPOSITE_REFLECTIVITY,
        frame_id=frame_id,
    )
    source_path = Path(source_uri.removeprefix("file://"))
    source_path.parent.mkdir(parents=True, exist_ok=True)
    source_path.write_bytes(gzip.compress(b"override-payload:MergedReflectivityQCComposite"))

    source = acquire_prepared_source(
        dataset=dataset,
        cycle="2026061105",
        frame_id=frame_id,
        source_uri_override=collection_root.as_uri(),
        artifact_ids=("observed_radar_composite_reflectivity",),
        workdir=tmp_path / "work",
        store=LocalFSStore(),
    )

    assert source.uri == f"mrms-s3://{frame_id}"
    assert (
        source.component_grib_path(
            artifact_id="observed_radar_composite_reflectivity",
            component_id="value",
            grib_match={MRMS_PRODUCT_SELECTOR_KEY: "MergedReflectivityQCComposite"},
        ).read_bytes()
        == b"override-payload:MergedReflectivityQCComposite"
    )


def _mrms_objects(
    timestamps_by_product: dict[str, tuple[str, ...]],
    *,
    payload_prefix: str = "payload",
) -> dict[str, bytes]:
    objects: dict[str, bytes] = {}
    for product in MRMS_PRODUCTS:
        for timestamp in timestamps_by_product.get(product.product, ()):
            frame_id = timestamp.replace("-", "")
            uri = mrms_product_uri_from_collection(
                collection_uri="s3://noaa-mrms-pds/CONUS",
                product=product,
                frame_id=frame_id,
            )
            objects[uri] = gzip.compress(f"{payload_prefix}:{product.product}".encode("utf-8"))
    return objects


class _FakeUriStore(UriStore):
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = dict(objects)
        self.name = "fake-uri"
        self.listed_prefixes: list[str] = []
        self.get_to_file_calls = 0

    def read_bytes(self, *, uri: str) -> bytes:
        try:
            return self.objects[uri]
        except KeyError as exc:
            raise FileNotFoundError(uri) from exc

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        self.objects[uri] = data

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        self.write_bytes(uri=uri, data=data)

    def delete_uri(self, *, uri: str) -> None:
        self.objects.pop(uri, None)

    def exists(self, *, uri: str) -> bool:
        return uri in self.objects

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [obj.uri for obj in self.list_objects(prefix_uri=prefix_uri)]

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        self.listed_prefixes.append(prefix_uri)
        return [
            UriObject(uri=uri, size=len(payload))
            for uri, payload in sorted(self.objects.items())
            if uri.startswith(prefix_uri)
        ]

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        self.get_to_file_calls += 1
        try:
            payload = self.objects[uri]
        except KeyError as exc:
            raise FileNotFoundError(uri) from exc
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(payload)

    def put_file(self, *, uri: str, src: Path) -> None:
        self.objects[uri] = src.read_bytes()

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        self.put_file(uri=uri, src=src)
