from __future__ import annotations

import json
from pathlib import Path

import pytest
from weather_etl.config.catalog import catalog_requirements, parse_catalog


def test_catalog_accepts_current_catalog(repo_root: Path) -> None:
    parse_catalog(json.loads((repo_root / "config" / "catalog.json").read_text(encoding="utf-8")))


def test_catalog_requirements_collects_all_source_artifact_ids() -> None:
    requirements = catalog_requirements(
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
            "contourLayers": [
                {"id": "pressure", "source": {"artifactId": "prmsl_msl", "bands": [{"id": "value"}]}}
            ],
            "particleLayers": [
                {"id": "wind", "source": {"artifactId": "wind10m_uv", "bands": [{"id": "u"}, {"id": "v"}]}}
            ],
        }
    )

    assert requirements.source_artifact_ids == {
        "tmp_surface",
        "precip_type_surface",
        "prmsl_msl",
        "wind10m_uv",
    }
    assert requirements.raster_layers[0].optional[0].artifact_id == "precip_type_surface"


def test_catalog_requirements_rejects_duplicate_overlay_ids() -> None:
    with pytest.raises(SystemExit, match="duplicate id"):
        catalog_requirements(
            {
                "catalogVersion": "test",
                "rasterLayers": [
                    {
                        "id": "temperature",
                        "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]},
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
                    },
                    {
                        "id": "precipitation_type",
                        "style": "precipitation-type-pattern",
                        "source": {
                            "artifactId": "other_precip_type_surface",
                            "bands": [{"id": "snow_frac"}, {"id": "mix_frac"}],
                        },
                    },
                ],
            }
        )


def test_catalog_requirements_rejects_duplicate_raster_ids() -> None:
    with pytest.raises(SystemExit, match="duplicate id"):
        catalog_requirements(
            {
                "catalogVersion": "test",
                "rasterLayers": [
                    {"id": "temperature", "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]}},
                    {"id": "temperature", "source": {"artifactId": "rh_surface", "bands": [{"id": "value"}]}},
                ],
            }
        )


def test_catalog_requirements_rejects_missing_overlay_reference() -> None:
    with pytest.raises(SystemExit, match="references missing overlay layer"):
        catalog_requirements(
            {
                "catalogVersion": "test",
                "rasterLayers": [
                    {
                        "id": "temperature",
                        "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]},
                        "overlays": ["precipitation_type"],
                    }
                ],
                "overlayLayers": [],
            }
        )


@pytest.mark.parametrize(
    "source",
    (
        {"artifactId": "tmp_surface"},
        {"artifactId": "tmp_surface", "bands": []},
    ),
)
def test_catalog_requirements_rejects_invalid_source_bands(source: dict) -> None:
    with pytest.raises(SystemExit, match="Catalog source must define non-empty bands"):
        catalog_requirements(
            {
                "catalogVersion": "test",
                "rasterLayers": [{"id": "temperature", "source": source}],
            }
        )


def test_catalog_requirements_rejects_stale_band_input() -> None:
    with pytest.raises(SystemExit, match="Catalog source bands must not define 'input'"):
        catalog_requirements(
            {
                "catalogVersion": "test",
                "rasterLayers": [
                    {
                        "id": "temperature",
                        "source": {
                            "artifactId": "tmp_surface",
                            "bands": [{"id": "value", "input": {"kind": "stale"}}],
                        },
                    }
                ],
            }
        )
