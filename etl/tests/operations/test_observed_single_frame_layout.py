from __future__ import annotations

import hashlib
from types import SimpleNamespace

from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.pipeline import loaded_product_config, raw_pipeline_config
from weather_etl.config.pipeline import LoadedPipelineConfig, parse_pipeline_config
from weather_etl.config.sources import MRMS_AWS_S3_SOURCE_TYPE
from weather_etl.operations.run_layouts import publish_targets
from weather_etl.operations.run_layouts.observed_single_frame import (
    build_pinned_product_config_for_frame,
    run_target_for_observed_frame,
)


def _mrms_product_config():
    raw = raw_pipeline_config(
        dataset_ids=("mrms",),
        source_types={"mrms": MRMS_AWS_S3_SOURCE_TYPE},
        artifacts=("tmp_surface",),
    )
    raw["artifact_catalog"] = {
        "observed_radar_base_reflectivity": {
            "kind": "scalar",
            "parameter": "ReflectivityAtLowestAltitude",
            "level": "lowest altitude",
            "units": "dBZ",
            "source_transform": "identity",
            "encoding": {
                "id": "observed_radar_base_reflectivity_i8_0p5dbz_v1",
                "format": "linear-i8-v1",
                "dtype": "int8",
                "byte_order": "none",
                "scale": 0.5,
                "offset": 31.5,
                "nodata": -128,
                "finite_value_range": {"min": 0, "max": 75},
            },
            "components": [{"id": "value"}],
        },
    }
    raw["datasets"]["mrms"]["source"] = {
        "type": MRMS_AWS_S3_SOURCE_TYPE,
        "grid_id": "mrms_conus_0p01",
        "bucket": "noaa-mrms-pds",
        "prefix": "CONUS",
    }
    raw["datasets"]["mrms"]["lifecycle"] = {
        "type": "rolling_observed",
        "display_window_minutes": 120,
        "publish_scan_minutes": 180,
    }
    raw["datasets"]["mrms"]["artifacts"] = {
        "observed_radar_base_reflectivity": {
            "components": [{
                "id": "value",
                "grib_match": {
                    "MRMS_PRODUCT": "ReflectivityAtLowestAltitude",
                    "GRIB_ELEMENT": "ReflectivityAtLowestAltitude",
                },
            }],
        },
    }
    cfg = parse_pipeline_config(raw)
    return loaded_product_config(
        dataset_id="mrms",
        loaded_pipeline_config=LoadedPipelineConfig(raw=raw, config=cfg),
        catalog=catalog_for_dataset(cfg.dataset("mrms")),
    )


def test_run_target_for_observed_frame_derives_single_frame_identity() -> None:
    product_config = _mrms_product_config()

    target = run_target_for_observed_frame(
        product_config=product_config,
        dataset_id="mrms",
        frame_id="20260611000000",
    )

    suffix = hashlib.sha1("mrms:20260611000000".encode("utf-8")).hexdigest()[:8]
    assert target.dataset_id == "mrms"
    assert target.cycle == "2026061100"
    assert target.run_id == f"20260611T000000Z-{suffix}"
    assert target.snapshot_frames == ("20260611000000",)
    assert target.plan_frames == ("20260611000000",)
    assert target.rolling_anchor is not None
    assert target.rolling_anchor.isoformat() == "2026-06-11T00:00:00+00:00"


def test_build_pinned_product_config_pins_one_observed_frame() -> None:
    product_config = _mrms_product_config()

    effective = build_pinned_product_config_for_frame(
        product_config=product_config,
        dataset_id="mrms",
        frame_id="20260611000000",
    )

    workload = effective.raw_pipeline_config["datasets"]["mrms"]["workload"]
    assert workload == {"frames": ["20260611000000"]}
    assert effective.dataset("mrms").workload.frames == ("20260611000000",)


def test_build_pinned_product_config_rejects_forecast_dataset() -> None:
    product_config = loaded_product_config()

    try:
        build_pinned_product_config_for_frame(
            product_config=product_config,
            dataset_id="gfs",
            frame_id="20260611000000",
        )
    except SystemExit as exc:
        assert "does not expose observed timestamp frame ids" in str(exc)
    else:
        raise AssertionError("expected forecast observed-frame pinning to fail")


def test_rolling_publish_targets_emit_only_persisted_run_ids() -> None:
    product_config = _mrms_product_config()
    run_ids = ("20260611T123400Z-abcdef12", "20260611T123600Z-bcdef123")
    artifact_repo = SimpleNamespace(
        list_run_ids=lambda *, dataset_id, cycle: run_ids if (dataset_id, cycle) == ("mrms", "2026061112") else ()
    )

    targets = publish_targets(
        env=SimpleNamespace(artifact_repo=artifact_repo),
        product_config=product_config,
        dataset_id="mrms",
        cycles=("2026061112", "2026061111"),
    )

    assert [(target.cycle, target.run_id) for target in targets] == [
        ("2026061112", "20260611T123400Z-abcdef12"),
        ("2026061112", "20260611T123600Z-bcdef123"),
    ]


def test_forecast_publish_targets_emit_persisted_run_ids_for_repairs() -> None:
    product_config = loaded_product_config()
    run_ids = ("20260611T123400Z-abcdef12", "20260611T123600Z-bcdef123")
    artifact_repo = SimpleNamespace(
        list_run_ids=lambda *, dataset_id, cycle: run_ids if (dataset_id, cycle) == ("gfs", "2026061112") else ()
    )

    targets = publish_targets(
        env=SimpleNamespace(artifact_repo=artifact_repo),
        product_config=product_config,
        dataset_id="gfs",
        cycles=("2026061112", "2026061106"),
    )

    assert [(target.cycle, target.run_id) for target in targets] == [
        ("2026061112", "20260611T123400Z-abcdef12"),
        ("2026061112", "20260611T123600Z-bcdef123"),
        ("2026061106", None),
    ]
