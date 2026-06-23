from __future__ import annotations

from typing import Any

from weather_etl.config.pipeline import parse_pipeline_config
from weather_etl.config.product import product_config_document_digest
from weather_etl.state.manifest.schema import parse_cycle_manifest
from weather_etl.state.runs.metadata import RunMetadata, RunSnapshot
from weather_etl.state.runs.validation import PAYLOAD_CHECK_MODE, VALIDATION_SCHEMA, VALIDATION_SCHEMA_VERSION

from tests.fixtures.artifacts import DEFAULT_CODE_REVISION, DEFAULT_IMAGE_IDENTITY, DEFAULT_RUN_ID
from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.pipeline import minimal_pipeline_config

CYCLE = "2026051106"
NEWER_RUN_ID = "20260511T010000Z-00000000"
GENERATED_AT = "2026-05-11T07:00:00+00:00"


def write_snapshot(
    artifacts,
    *,
    run_id: str = DEFAULT_RUN_ID,
    pipeline_config: dict[str, Any] | None = None,
) -> None:
    cfg = pipeline_config or minimal_pipeline_config()
    dataset = parse_pipeline_config(cfg).dataset("gfs")
    catalog = catalog_for_dataset(dataset)
    artifacts.repository.ensure_run_snapshot(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        snapshot=RunSnapshot(
            metadata=RunMetadata(
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                product_config_digest=product_config_document_digest(pipeline=cfg, catalog=catalog),
            ),
            pipeline=cfg,
            catalog=catalog,
        ),
    )


def write_validation(artifacts, *, run_id: str = DEFAULT_RUN_ID, status: str = "passed") -> None:
    artifacts.repository.write_validation_report(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        report={
            "schema": VALIDATION_SCHEMA,
            "schema_version": VALIDATION_SCHEMA_VERSION,
            "dataset": "gfs",
            "cycle": CYCLE,
            "run_id": run_id,
            "generated_at": GENERATED_AT,
            "status": status,
            "payload_check_mode": PAYLOAD_CHECK_MODE,
            "product_config_digest": "sha256:" + "0" * 64,
            "expected": {"frames": ["000"], "artifacts": ["tmp_surface"], "marker_count": 1},
            "observed": {"expected_markers": 1, "unexpected_markers": 0, "total_markers": 1},
            "errors": [] if status == "passed" else ["failed"],
            "warnings": [],
        },
    )


def write_public_latest_current_manifests(artifacts, *, run_id: str = DEFAULT_RUN_ID) -> str:
    manifest = parse_cycle_manifest(run_manifest(run_id))
    public_uri = artifacts.repository.write_public_run_manifest(
        dataset_id="gfs",
        cycle=CYCLE,
        run_id=run_id,
        manifest=manifest,
    )
    artifacts.repository.write_latest_manifest(dataset_id="gfs", manifest=manifest)
    artifacts.repository.write_cycle_current_manifest(dataset_id="gfs", cycle=CYCLE, manifest=manifest)
    return public_uri


def run_manifest(run_id: str, *, revision: str = "abc123") -> dict[str, Any]:
    return {
        "schema": "weather-map.dataset-cycle-manifest",
        "schema_version": 7,
        "payload_contract": "field-binary-v2",
        "dataset": {"id": "gfs", "label": "GFS"},
        "run": {
            "cycle": CYCLE,
            "run_id": run_id,
            "payload_root": f"runs/gfs/{CYCLE}/{run_id}/payloads",
            "generated_at": GENERATED_AT,
            "revision": revision,
        },
        "frames": [{"id": "000", "lead_hours": 0, "valid_at": GENERATED_AT}],
        "artifacts": {
            "tmp_surface": {
                "id": "tmp_surface",
                "kind": "scalar",
                "units": "C",
                "parameter": "tmp",
                "level": "surface",
                "components": ["value"],
                "grid": {
                    "id": "gfs_0p25_global",
                    "crs": "EPSG:4326",
                    "nx": 1,
                    "ny": 1,
                    "lon0": 0,
                    "lat0": 0,
                    "dx": 1,
                    "dy": 1,
                    "origin": "cell_center",
                    "layout": "row_major",
                    "x_wrap": "repeat",
                    "y_mode": "clamp",
                },
                "encoding": {"id": "tmp_surface_i16_v1", "format": "linear-i16-v1", "dtype": "int16"},
                "payload_file": "tmp_surface.i16.bin",
                "frames": {
                    "000": {
                        "path": f"runs/gfs/{CYCLE}/{run_id}/payloads/000/tmp_surface.i16.bin",
                        "byte_length": 2,
                        "sha256": "a" * 64,
                    },
                },
            }
        },
    }
