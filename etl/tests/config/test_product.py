from __future__ import annotations

import json
from pathlib import Path

import pytest
from weather_etl.config.pipeline import LoadedPipelineConfig, parse_pipeline_config
from weather_etl.config.product import (
    build_loaded_product_config,
    load_product_config,
    product_config_digest,
    product_config_document_digest,
)

from tests.fixtures.artifact_configs import precip_type_config, wind_artifact_config
from tests.fixtures.catalog import catalog_for_dataset
from tests.fixtures.pipeline import catalog_artifact, minimal_pipeline_config


def test_load_product_config_loads_and_validates_config_catalog_pair(tmp_path: Path) -> None:
    raw_config = minimal_pipeline_config()
    catalog = catalog_for_dataset(parse_pipeline_config(raw_config).dataset("gfs"))
    config_path = tmp_path / "pipeline.json"
    catalog_path = tmp_path / "catalog.json"
    config_path.write_text(json.dumps(raw_config), encoding="utf-8")
    catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

    loaded = load_product_config(
        pipeline_uri=config_path.as_uri(),
        catalog_uri=catalog_path.as_uri(),
    )

    assert loaded.raw_pipeline_config == raw_config
    assert loaded.catalog == catalog
    assert loaded.catalog_requirements.source_artifact_ids == {"tmp_surface"}
    assert product_config_digest(loaded) == _paired_digest(raw_config=raw_config, catalog=catalog)
    assert loaded.pipeline_config.dataset("gfs").id == "gfs"


@pytest.mark.parametrize(
    ("payload", "message"),
    (
        (b"{", "Failed to parse JSON document"),
        (b'["not", "object"]', "must be an object"),
    ),
)
def test_load_product_config_rejects_invalid_catalog_json(
    tmp_path: Path,
    payload: bytes,
    message: str,
) -> None:
    config_path = tmp_path / "pipeline.json"
    catalog_path = tmp_path / "catalog.json"
    config_path.write_text(json.dumps(minimal_pipeline_config()), encoding="utf-8")
    catalog_path.write_bytes(payload)

    with pytest.raises(SystemExit, match=message):
        load_product_config(
            pipeline_uri=config_path.as_uri(),
            catalog_uri=catalog_path.as_uri(),
        )


def test_product_config_rejects_unknown_catalog_artifact() -> None:
    with pytest.raises(SystemExit, match="unknown artifact"):
        _build_product_config(
            minimal_pipeline_config(),
            _catalog(source={"artifactId": "missing_surface", "bands": [{"id": "value"}]}),
        )


def test_product_config_rejects_catalog_component_mismatch() -> None:
    with pytest.raises(SystemExit, match="components mismatch"):
        _build_product_config(
            minimal_pipeline_config(),
            _catalog(source={"artifactId": "tmp_surface", "bands": [{"id": "u"}, {"id": "v"}]}),
        )


def test_product_config_rejects_stale_vector_components() -> None:
    raw_config = minimal_pipeline_config()
    raw_config["artifact_catalog"]["wind10m_uv"] = catalog_artifact(wind_artifact_config())

    with pytest.raises(SystemExit, match="components mismatch"):
        _build_product_config(
            raw_config,
            _catalog(source={"artifactId": "wind10m_uv", "bands": [{"id": "v"}, {"id": "u"}]}),
        )


def test_product_config_validates_contour_and_particle_sources() -> None:
    raw_config = minimal_pipeline_config()
    raw_config["artifact_catalog"]["wind10m_uv"] = catalog_artifact(wind_artifact_config())

    with pytest.raises(SystemExit, match="components mismatch"):
        _build_product_config(
            raw_config,
            {
                "catalogVersion": "test",
                "rasterLayers": [],
                "contourLayers": [
                    {"id": "temperature", "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]}}
                ],
                "particleLayers": [
                    {
                        "id": "wind",
                        "source": {"artifactId": "wind10m_uv", "bands": [{"id": "v"}, {"id": "u"}]},
                    }
                ],
            },
        )


def test_product_config_rejects_required_raster_artifact_absent_from_all_workloads() -> None:
    raw_config = minimal_pipeline_config()
    raw_config["artifact_catalog"]["unused_surface"] = catalog_artifact(_scalar_artifact())

    with pytest.raises(SystemExit, match="absent from all dataset workloads"):
        _build_product_config(
            raw_config,
            _catalog(source={"artifactId": "unused_surface", "bands": [{"id": "value"}]}),
        )


def test_product_config_allows_optional_overlay_artifact_absent_from_workloads() -> None:
    raw_config = minimal_pipeline_config()
    raw_config["artifact_catalog"]["precip_type_surface"] = catalog_artifact(precip_type_config())

    _build_product_config(
        raw_config,
        {
            "catalogVersion": "test",
            "rasterLayers": [
                {
                    "id": "temperature",
                    "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]},
                    "overlays": ["precipitation_type"],
                }
            ],
            "overlayLayers": [
                {
                    "id": "precipitation_type",
                    "style": "precipitation-type-pattern",
                    "source": {
                        "artifactId": "precip_type_surface",
                        "bands": [{"id": "snow_frac"}, {"id": "mix_frac"}],
                    },
                    "optional": True,
                }
            ],
        },
    )


def _build_product_config(raw_config: dict, catalog: dict) -> None:
    build_loaded_product_config(
        loaded_pipeline_config=LoadedPipelineConfig(raw=raw_config, config=parse_pipeline_config(raw_config)),
        catalog=catalog,
    )


def _catalog(*, source: dict) -> dict:
    return {
        "catalogVersion": "test",
        "rasterLayers": [
            {
                "id": "test_layer",
                "source": source,
            }
        ],
    }


def _paired_digest(*, raw_config: dict, catalog: dict) -> str:
    return product_config_document_digest(pipeline=raw_config, catalog=catalog)


def _scalar_artifact() -> dict:
    return {
        "kind": "scalar",
        "parameter": "unused",
        "level": "surface",
        "units": "1",
        "encoding": {
            "id": "unused_i16_v1",
            "format": "linear-i16-v1",
            "dtype": "int16",
            "byte_order": "little",
            "scale": 1,
            "offset": 0,
            "nodata": -32768,
        },
        "components": [{"id": "value"}],
    }
