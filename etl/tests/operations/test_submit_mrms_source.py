from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tests.fixtures.aws import FakeBatchClient, FakeDynamoClient
from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.manifests import cycle_manifest_dict, write_latest_manifest
from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.environment import EtlEnvironment
from weather_etl.operations.submit_mrms_source import MrmsSourceObject, submit_mrms_source_object
from weather_etl.sources.mrms.layout import mrms_product_uri_from_collection
from weather_etl.sources.mrms.products import MRMS_PRODUCTS
from weather_etl.storage.base import UriObject, UriStore, UriWriteMetadata
from weather_etl.storage.local import LocalFSStore
from weather_etl.storage.routing import RoutingStore


def test_submit_mrms_source_skips_unsupported_key(tmp_path: Path) -> None:
    result = submit_mrms_source_object(
        batch=FakeBatchClient(),
        ddb=FakeDynamoClient(),
        queue="weather-etl",
        job_definition="weather-etl-worker-mrms:1",
        frame_claim_table="frame-claims",
        env=_env(tmp_path, existing_s3=()),
        source_object=MrmsSourceObject(
            bucket="noaa-mrms-pds",
            key="CONUS/Unsupported/20260611/file.grib2.gz",
        ),
    )

    assert result.skipped == 1
    assert result.outcomes[0].reason == "key_filter"


def test_submit_mrms_source_waits_for_complete_product_pair(tmp_path: Path) -> None:
    key = (
        "CONUS/ReflectivityAtLowestAltitude_00.50/20260611/"
        "MRMS_ReflectivityAtLowestAltitude_00.50_20260611-053640.grib2.gz"
    )

    result = submit_mrms_source_object(
        batch=FakeBatchClient(),
        ddb=FakeDynamoClient(),
        queue="weather-etl",
        job_definition="weather-etl-worker-mrms:1",
        frame_claim_table="frame-claims",
        env=_env(tmp_path, existing_s3=()),
        source_object=MrmsSourceObject(bucket="noaa-mrms-pds", key=key),
    )

    assert result.pending == 1
    assert result.outcomes[0].scope == "frame"
    assert result.outcomes[0].frame_id == "20260611053640"
    assert result.outcomes[0].reason == "waiting_for_product_pair"


def test_submit_mrms_source_creates_single_frame_run_and_batch_job(tmp_path: Path) -> None:
    frame_id = "20260611195940"
    existing = _existing_product_uris(frame_id)
    env = _env(tmp_path, existing_s3=existing)
    _write_observed_latest_manifest(
        env,
        cycle="2026061120",
        frame_id="20260611200000",
        valid_at="2026-06-11T20:00:00Z",
        run_id="20260611T200000Z-00000000",
    )
    batch = FakeBatchClient()
    ddb = FakeDynamoClient()

    result = submit_mrms_source_object(
        batch=batch,
        ddb=ddb,
        queue="weather-etl",
        job_definition="weather-etl-worker-mrms:1",
        frame_claim_table="frame-claims",
        env=env,
        source_object=MrmsSourceObject(
            bucket="noaa-mrms-pds",
            key=_mrms_product_key(product=MRMS_PRODUCTS[0], frame_id=frame_id),
        ),
    )

    assert result.submitted == 1
    assert result.outcomes[0].cycle == "2026061119"
    assert result.outcomes[0].frame_id == frame_id
    assert result.outcomes[0].run_id is not None
    assert result.outcomes[0].run_id.startswith("20260611T195940Z-")
    assert len(batch.submissions) == 1
    submission = batch.submissions[0]
    assert submission["jobQueue"] == "weather-etl"
    assert submission["jobDefinition"] == "weather-etl-worker-mrms:1"
    env_vars = {item["name"]: item["value"] for item in submission["containerOverrides"]["environment"]}
    assert env_vars["DATASET_ID"] == "mrms"
    assert env_vars["CYCLE"] == "2026061119"
    assert env_vars["FRAME_ID"] == frame_id
    assert "GRIB_SOURCE_URI" not in env_vars
    assert ddb.items[f"mrms#2026061119#{result.outcomes[0].run_id}#{frame_id}"]["state"] == "claimed"


class _FakeS3Store(UriStore):
    def __init__(self, existing: tuple[str, ...]) -> None:
        self.existing = set(existing)
        self.name = "fake-s3"

    def read_bytes(self, *, uri: str) -> bytes:
        raise FileNotFoundError(uri)

    def write_bytes(self, *, uri: str, data: bytes) -> None:
        raise NotImplementedError

    def write_bytes_with_metadata(self, *, uri: str, data: bytes, metadata: UriWriteMetadata) -> None:
        raise NotImplementedError

    def delete_uri(self, *, uri: str) -> None:
        self.existing.discard(uri)

    def exists(self, *, uri: str) -> bool:
        return uri in self.existing

    def list_prefix(self, *, prefix_uri: str) -> list[str]:
        return [uri for uri in sorted(self.existing) if uri.startswith(prefix_uri)]

    def list_objects(self, *, prefix_uri: str) -> list[UriObject]:
        return []

    def get_to_file(self, *, uri: str, dst: Path) -> None:
        raise FileNotFoundError(uri)

    def put_file(self, *, uri: str, src: Path) -> None:
        raise NotImplementedError

    def put_file_with_metadata(self, *, uri: str, src: Path, metadata: UriWriteMetadata) -> None:
        raise NotImplementedError


def _env(tmp_path: Path, *, existing_s3: tuple[str, ...]) -> EtlEnvironment:
    pipeline = _raw_mrms_pipeline()
    dataset = parse_pipeline_config(pipeline).dataset("mrms")
    catalog = catalog_for_dataset(dataset)
    config_dir = tmp_path / "config"
    artifact_root = tmp_path / "artifacts"
    config_dir.mkdir(parents=True, exist_ok=True)
    pipeline_path = config_dir / "pipeline.json"
    catalog_path = config_dir / "catalog.json"
    pipeline_path.write_text(json.dumps(pipeline), encoding="utf-8")
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
    return EtlEnvironment(
        artifact_root_uri=artifact_root.as_uri(),
        pipeline_uri=pipeline_path.as_uri(),
        catalog_uri=catalog_path.as_uri(),
        store=RoutingStore(stores={"file": LocalFSStore(), "s3": _FakeS3Store(existing_s3)}),
    )


def _raw_mrms_pipeline() -> dict[str, Any]:
    return {
        "version": 3,
        "artifact_catalog": {
            "observed_radar_base_reflectivity": _artifact_catalog_entry("ReflectivityAtLowestAltitude"),
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
                    "observed_radar_base_reflectivity": _dataset_artifact_entry("ReflectivityAtLowestAltitude"),
                    "observed_radar_composite_reflectivity": _dataset_artifact_entry("MergedReflectivityQCComposite"),
                },
            },
        },
    }


def _artifact_catalog_entry(parameter: str) -> dict[str, Any]:
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


def _dataset_artifact_entry(product: str) -> dict[str, Any]:
    return {
        "components": [
            {
                "id": "value",
                "grib_match": {
                    "MRMS_PRODUCT": product,
                    "GRIB_ELEMENT": product,
                },
            }
        ],
    }


def _existing_product_uris(frame_id: str) -> tuple[str, ...]:
    return tuple(
        mrms_product_uri_from_collection(
            collection_uri="s3://noaa-mrms-pds/CONUS",
            product=product,
            frame_id=frame_id,
        )
        for product in MRMS_PRODUCTS
    )


def _mrms_product_key(*, product: str, frame_id: str) -> str:
    uri = mrms_product_uri_from_collection(
        collection_uri="s3://noaa-mrms-pds/CONUS",
        product=product,
        frame_id=frame_id,
    )
    return uri.removeprefix("s3://noaa-mrms-pds/")


def _write_observed_latest_manifest(
    env: EtlEnvironment,
    *,
    cycle: str,
    frame_id: str,
    valid_at: str,
    run_id: str,
) -> None:
    product_config = env.load_product_config()
    dataset = product_config.dataset("mrms")
    manifest = cycle_manifest_dict(
        dataset,
        cycle=cycle,
        run_id=run_id,
        artifact_ids=("observed_radar_base_reflectivity", "observed_radar_composite_reflectivity"),
        frames=("000",),
        generated_at=valid_at,
        revision=f"mrms-{frame_id}-revision",
    )
    manifest["frames"] = [{
        "id": frame_id,
        "lead_hours": 0,
        "valid_at": valid_at,
    }]
    for artifact_id, artifact in manifest["artifacts"].items():
        frame_payload = artifact["frames"]["000"]
        frame_payload["path"] = f"runs/mrms/{cycle}/{run_id}/payloads/{frame_id}/{artifact['payload_file']}"
        artifact["frames"] = {frame_id: frame_payload}
        manifest["artifacts"][artifact_id] = artifact
    write_latest_manifest(env.artifact_repo, dataset_id="mrms", manifest=manifest)
