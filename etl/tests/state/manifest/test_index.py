from __future__ import annotations

from pathlib import Path

import pytest
from weather_etl.config.pipeline import PipelineConfig, parse_pipeline_config
from weather_etl.config.product import LoadedProductConfig
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.state.manifest.constants import (
    DATA_BINARY_CONTRACT,
    MANIFEST_INDEX_SCHEMA,
    MANIFEST_INDEX_SCHEMA_VERSION,
)
from weather_etl.state.manifest.index import build_index
from weather_etl.storage.routing import make_store

from tests.fixtures.artifact_configs import (
    cloud_layers_config,
    gfs_precip_total_config,
    minimal_artifact_config,
    precip_rate_config,
    precip_type_config,
    wind_artifact_config,
)
from tests.fixtures.artifacts import DEFAULT_RUN_ID
from tests.fixtures.manifests import cycle_manifest_dict, write_latest_manifest
from tests.fixtures.pipeline import catalog_artifact, dataset_artifact, loaded_product_config, minimal_pipeline_config


def _pipeline_config() -> PipelineConfig:
    tmp = minimal_artifact_config()
    precip_rate = precip_rate_config()
    precip_type = precip_type_config()
    wind = wind_artifact_config()
    cloud_layers = cloud_layers_config()
    derived_scalar = gfs_precip_total_config()
    cfg = minimal_pipeline_config()
    cfg["artifact_catalog"].update(
        {
            "cloud_layers": catalog_artifact(cloud_layers),
            "derived_scalar": catalog_artifact(derived_scalar),
            "prate_surface": catalog_artifact(precip_rate),
            "precip_type_surface": catalog_artifact(precip_type),
            "wind10m_uv": catalog_artifact(wind),
        }
    )
    cfg["datasets"]["gfs"]["workload"]["artifacts"] = [
        "tmp_surface",
        "cloud_layers",
        "derived_scalar",
        "precip_type_surface",
        "wind10m_uv",
    ]
    cfg["datasets"]["gfs"]["artifacts"] = {
        "tmp_surface": dataset_artifact(tmp),
        "cloud_layers": dataset_artifact(cloud_layers),
        "derived_scalar": dataset_artifact(derived_scalar),
        "precip_type_surface": dataset_artifact(precip_type),
        "wind10m_uv": dataset_artifact(wind),
    }
    cfg["datasets"]["icon"] = {
        "label": "ICON",
        "source": {
            "type": "icon_dwd_icosahedral",
            "grid_id": "icon_global_regridded_0p125",
            "base_url": "https://example.test/icon",
            "rate_limit_seconds": 0.0,
        },
        "workload": {
            "frame_start": 0,
            "frame_end": 0,
            "artifacts": ["tmp_surface", "prate_surface"],
        },
        "artifacts": {
            "tmp_surface": {
                "components": [{"id": "value", "grib_match": {"ICON_PARAM": "t_2m"}}],
            },
            "prate_surface": dataset_artifact(precip_rate),
        },
    }
    return parse_pipeline_config(cfg)


def _catalog() -> dict:
    return {
        "catalogVersion": "test-forecast-catalog",
        "rasterLayers": [
            {"id": "native_scalar", "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]}},
            {"id": "unsupported_scalar", "source": {"artifactId": "prate_surface", "bands": [{"id": "value"}]}},
            {"id": "etl_derived", "source": {"artifactId": "derived_scalar", "bands": [{"id": "value"}]}},
            {
                "id": "frontend_derived",
                "source": {
                    "artifactId": "wind10m_uv",
                    "bands": [{"id": "u"}, {"id": "v"}],
                },
            },
            {
                "id": "cloud_layers",
                "source": {
                    "artifactId": "cloud_layers",
                    "bands": [{"id": "low"}, {"id": "middle"}, {"id": "high"}],
                },
            },
            {
                "id": "top_level_optional_overlay",
                "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]},
                "overlays": ["precipitation_type"],
            },
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
    }


def _repo(root: Path) -> ArtifactRepository:
    return ArtifactRepository.for_root(store=make_store(), artifact_root_uri=root.as_uri())


def _build_index(
    repo: ArtifactRepository,
    *,
    product_config: LoadedProductConfig,
) -> dict:
    return build_index(
        product_config=product_config,
        artifact_repo=repo,
        generated_at="2026-05-16T00:00:00Z",
    )


def _default_product_config() -> LoadedProductConfig:
    return loaded_product_config(pipeline_config=_pipeline_config(), catalog=_catalog())


def _product_config_with_catalog(*, pipeline_config: PipelineConfig, catalog: dict) -> LoadedProductConfig:
    return loaded_product_config(pipeline_config=pipeline_config, catalog=catalog)


def test_builds_layer_dataset_availability_from_config_and_latest_manifests(tmp_path: Path) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path)
    gfs = cfg.dataset("gfs")
    icon = cfg.dataset("icon")
    write_latest_manifest(
        repo,
        dataset_id="gfs",
        manifest=cycle_manifest_dict(
            gfs,
            cycle="2026051606",
            artifact_ids=("tmp_surface", "wind10m_uv"),
        ),
    )
    write_latest_manifest(
        repo,
        dataset_id="icon",
        manifest=cycle_manifest_dict(
            icon,
            cycle="2026051606",
            artifact_ids=("tmp_surface",),
        ),
    )

    manifest_index = _build_index(repo, product_config=product_config)

    assert manifest_index["schema"] == MANIFEST_INDEX_SCHEMA
    assert manifest_index["schema_version"] == MANIFEST_INDEX_SCHEMA_VERSION
    assert manifest_index["payload_contract"] == DATA_BINARY_CONTRACT
    assert manifest_index["catalog_version"] == "test-forecast-catalog"
    assert "latest_cycle" not in manifest_index["datasets"]["gfs"]
    assert "latest_manifest_path" not in manifest_index["datasets"]["gfs"]
    latest = manifest_index["datasets"]["gfs"]["latest"]
    assert latest is not None
    assert "schema" not in latest
    assert "schema_version" not in latest
    assert "payload_contract" not in latest
    assert latest["run"]["cycle"] == "2026051606"
    assert latest["frames"][0]["id"] == "000"
    latest_artifact = latest["artifacts"]["tmp_surface"]
    assert latest_artifact["byte_length"] == 4
    assert latest_artifact["payload_file"] == "tmp_surface.i16.bin"
    assert "frames" not in latest_artifact
    assert "path" not in latest_artifact
    assert "sha256" not in latest_artifact

    native_scalar = manifest_index["layers"]["native_scalar"]["datasets"]
    assert native_scalar["gfs"]["state"] == "available"
    assert native_scalar["gfs"]["support"] == "native"

    unsupported_scalar = manifest_index["layers"]["unsupported_scalar"]["datasets"]
    assert unsupported_scalar["gfs"]["state"] == "unsupported"
    assert unsupported_scalar["gfs"]["support"] == "unavailable"
    assert unsupported_scalar["icon"]["state"] == "temporarily_unavailable"

    etl_derived = manifest_index["layers"]["etl_derived"]["datasets"]
    assert etl_derived["gfs"]["state"] == "temporarily_unavailable"
    assert etl_derived["gfs"]["support"] == "etl-derived"

    frontend_derived = manifest_index["layers"]["frontend_derived"]["datasets"]
    assert frontend_derived["gfs"]["state"] == "available"
    assert frontend_derived["gfs"]["support"] == "frontend-derived"
    assert frontend_derived["gfs"]["required_artifacts"] == ["wind10m_uv"]

    cloud_layers = manifest_index["layers"]["cloud_layers"]["datasets"]
    assert cloud_layers["gfs"]["state"] == "temporarily_unavailable"
    assert cloud_layers["gfs"]["support"] == "frontend-derived"
    assert cloud_layers["gfs"]["required_artifacts"] == ["cloud_layers"]
    assert cloud_layers["icon"]["state"] == "unsupported"

    top_level = manifest_index["layers"]["top_level_optional_overlay"]["datasets"]["gfs"]
    assert top_level["state"] == "available"
    assert top_level["support"] == "native"
    assert top_level["required_artifacts"] == ["tmp_surface"]
    assert top_level["optional_artifacts"] == ["precip_type_surface"]


def test_builds_from_full_latest_manifest(tmp_path: Path) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path)
    gfs = cfg.dataset("gfs")
    latest_manifest = cycle_manifest_dict(gfs, cycle="2026051606", artifact_ids=("tmp_surface",))
    write_latest_manifest(repo, dataset_id="gfs", manifest=latest_manifest)

    manifest_index = _build_index(repo, product_config=product_config)

    latest = manifest_index["datasets"]["gfs"]["latest"]
    assert latest is not None
    assert latest["run"]["cycle"] == "2026051606"
    assert latest["run"]["run_id"] == DEFAULT_RUN_ID
    assert latest["artifacts"]["tmp_surface"]["payload_file"] == "tmp_surface.i16.bin"
    assert manifest_index["layers"]["native_scalar"]["datasets"]["gfs"]["state"] == "available"


def test_sets_latest_to_null_when_latest_manifest_is_malformed(tmp_path: Path) -> None:
    product_config = _default_product_config()
    repo = _repo(tmp_path)
    repo.store.write_bytes(uri=repo.paths.latest_manifest_uri(dataset_id="gfs"), data=b"{not-json")

    manifest_index = _build_index(repo, product_config=product_config)

    assert manifest_index["datasets"]["gfs"]["latest"] is None
    assert manifest_index["layers"]["native_scalar"]["datasets"]["gfs"]["state"] == "temporarily_unavailable"


def test_strict_build_rejects_malformed_latest_manifest(tmp_path: Path) -> None:
    product_config = _default_product_config()
    repo = _repo(tmp_path)
    repo.store.write_bytes(uri=repo.paths.latest_manifest_uri(dataset_id="gfs"), data=b"{not-json")

    with pytest.raises(SystemExit, match="latest manifest for dataset 'gfs' is invalid"):
        build_index(
            product_config=product_config,
            artifact_repo=repo,
            generated_at="2026-05-16T00:00:00Z",
            strict_latest_manifests=True,
        )


@pytest.mark.parametrize(
    ("case", "mutation", "expected_state"),
    (
        ("valid", None, "available"),
        ("wrong_components", {"components": ["low", "high", "middle"]}, "temporarily_unavailable"),
    ),
)
def test_cloud_layers_layer_requires_low_middle_high_components(
    tmp_path: Path,
    case: str,
    mutation: dict | None,
    expected_state: str,
) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path / case)
    gfs = cfg.dataset("gfs")
    latest_manifest = cycle_manifest_dict(
        gfs,
        cycle="2026051606",
        artifact_ids=("cloud_layers",),
    )
    if mutation is not None:
        latest_manifest["artifacts"]["cloud_layers"].update(mutation)
    write_latest_manifest(repo, dataset_id="gfs", manifest=latest_manifest)

    manifest_index = _build_index(
        repo,
        product_config=_product_config_with_catalog(
            pipeline_config=cfg,
            catalog={
                "catalogVersion": "test-forecast-catalog",
                "rasterLayers": [
                    {
                        "id": "cloud_layers",
                        "source": {
                            "artifactId": "cloud_layers",
                            "bands": [{"id": "low"}, {"id": "middle"}, {"id": "high"}],
                        },
                    }
                ],
            },
        ),
    )

    entry = manifest_index["layers"]["cloud_layers"]["datasets"]["gfs"]
    assert entry["state"] == expected_state
    assert entry["support"] == "frontend-derived"
    assert entry["required_artifacts"] == ["cloud_layers"]


def test_rejects_stale_raster_band_input(tmp_path: Path) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path)

    with pytest.raises(SystemExit, match="Catalog source bands must not define 'input'"):
        _build_index(
            repo,
            product_config=_product_config_with_catalog(
                pipeline_config=cfg,
                catalog={
                    "catalogVersion": "test-forecast-catalog",
                    "rasterLayers": [
                        {
                            "id": "unknown_input",
                            "source": {
                                "artifactId": "cloud_layers",
                                "bands": [{"id": "speed", "input": {"kind": "unknown-input"}}],
                            },
                        }
                    ],
                },
            ),
        )


@pytest.mark.parametrize(
    ("case", "overlay", "expected_error"),
    (
        (
            "unsupported_style",
            {
                "id": "precipitation_type",
                "style": "unsupported-overlay-style",
                "source": {
                    "artifactId": "precip_type_surface",
                    "bands": [{"id": "snow_frac"}, {"id": "mix_frac"}],
                },
            },
            "Unsupported layer overlay style: 'unsupported-overlay-style'",
        ),
        (
            "empty_bands",
            {
                "id": "precipitation_type",
                "style": "precipitation-type-pattern",
                "source": {
                    "artifactId": "precip_type_surface",
                    "bands": [],
                },
            },
            "Catalog source must define non-empty bands",
        ),
    ),
)
def test_rejects_invalid_overlay_source_shapes(
    tmp_path: Path,
    case: str,
    overlay: dict,
    expected_error: str,
) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path / case)

    with pytest.raises(SystemExit, match=expected_error):
        _build_index(
            repo,
            product_config=_product_config_with_catalog(
                pipeline_config=cfg,
                catalog={
                    "catalogVersion": "test-forecast-catalog",
                    "rasterLayers": [
                        {
                            "id": "invalid_overlay",
                            "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]},
                            "overlays": ["precipitation_type"],
                        }
                    ],
                    "overlayLayers": [overlay],
                },
            ),
        )


@pytest.mark.parametrize(
    ("case", "source"),
    (
        ("missing", {"artifactId": "tmp_surface"}),
        ("empty", {"artifactId": "tmp_surface", "bands": []}),
    ),
)
def test_rejects_invalid_raster_source_shapes(tmp_path: Path, case: str, source: dict) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path / case)

    with pytest.raises(SystemExit, match="Catalog source must define non-empty bands"):
        _build_index(
            repo,
            product_config=_product_config_with_catalog(
                pipeline_config=cfg,
                catalog={
                    "catalogVersion": "test-forecast-catalog",
                    "rasterLayers": [{"id": "invalid_raster", "source": source}],
                },
            ),
        )


def test_sets_latest_to_null_when_no_latest_manifest_exists(tmp_path: Path) -> None:
    product_config = _default_product_config()
    repo = _repo(tmp_path)

    manifest_index = _build_index(repo, product_config=product_config)

    assert manifest_index["datasets"]["gfs"]["latest"] is None
    assert manifest_index["datasets"]["icon"]["latest"] is None


@pytest.mark.parametrize("case", ("missing", "inconsistent"))
def test_ignores_latest_with_missing_or_inconsistent_frame_metadata(tmp_path: Path, case: str) -> None:
    product_config = _default_product_config()
    cfg = product_config.pipeline_config
    repo = _repo(tmp_path)
    gfs = cfg.dataset("gfs")
    manifest = cycle_manifest_dict(gfs, cycle="2026051606", artifact_ids=("tmp_surface",))
    if case == "missing":
        del manifest["artifacts"]["tmp_surface"]["frames"]["003"]
    else:
        manifest["artifacts"]["tmp_surface"]["frames"]["003"]["byte_length"] = 8
    write_latest_manifest(repo, dataset_id="gfs", manifest=manifest)

    manifest_index = _build_index(repo, product_config=product_config)

    assert manifest_index["datasets"]["gfs"]["latest"] is None
    assert manifest_index["layers"]["native_scalar"]["datasets"]["gfs"]["state"] == "temporarily_unavailable"
