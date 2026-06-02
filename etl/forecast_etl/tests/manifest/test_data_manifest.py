from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Iterable

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.config.resolved import DatasetConfig, PipelineConfig
from forecast_etl.manifest.constants import (
    DATA_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from forecast_etl.manifest.data_manifest import (
    FORECAST_MANIFEST_SCHEMA,
    FORECAST_MANIFEST_SCHEMA_VERSION,
    build_data_manifest,
)
from forecast_etl.manifest.pointers import LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.storage.routing import make_store
from forecast_etl.tests.fixtures.artifact_configs import (
    cloud_layers_config,
    minimal_artifact_config,
    precip_rate_config,
    precip_type_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID
from forecast_etl.tests.fixtures.pipeline import catalog_artifact, dataset_artifact, minimal_pipeline_config


def _pipeline_config() -> PipelineConfig:
    tmp = minimal_artifact_config()
    precip_rate = precip_rate_config()
    precip_type = precip_type_config()
    wind = wind_artifact_config()
    cloud_layers = cloud_layers_config()
    cfg = minimal_pipeline_config()
    cfg["artifact_catalog"].update(
        {
            "cloud_layers": catalog_artifact(cloud_layers),
            "prate_surface": catalog_artifact(precip_rate),
            "precip_type_surface": catalog_artifact(precip_type),
            "wind10m_uv": catalog_artifact(wind),
        }
    )
    cfg["datasets"]["gfs"]["workload"]["artifacts"] = [
        "tmp_surface",
        "cloud_layers",
        "precip_type_surface",
        "wind10m_uv",
    ]
    cfg["datasets"]["gfs"]["artifacts"] = {
        "tmp_surface": dataset_artifact(tmp),
        "cloud_layers": dataset_artifact(cloud_layers),
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


def _forecast_catalog() -> dict:
    return {
        "catalogVersion": "test-forecast-catalog",
        "rasterLayers": [
            {"id": "native_scalar", "source": {"artifactId": "tmp_surface", "bands": [{"id": "value"}]}},
            {"id": "unsupported_scalar", "source": {"artifactId": "prate_surface", "bands": [{"id": "value"}]}},
            {"id": "etl_derived", "source": {"artifactId": "precip_type_surface", "bands": [{"id": "value"}]}},
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


def _latest_manifest(dataset: DatasetConfig, *, cycle: str, artifact_ids: Iterable[str]) -> dict:
    frames = ("000", "003")
    artifacts = {}
    for artifact_id in artifact_ids:
        artifact = dataset.artifacts[artifact_id]
        dtype_suffix = "i16" if artifact.encoding.dtype == "int16" else "i8"
        artifacts[artifact_id] = {
            "id": artifact_id,
            "kind": artifact.kind,
            "units": artifact.units,
            "parameter": artifact.parameter,
            "level": artifact.level,
            "components": list(artifact.component_ids),
            "grid": {
                "id": dataset.source.grid_id,
                "crs": "EPSG:4326",
                "nx": 2,
                "ny": 2,
                "lon0": 0,
                "lat0": 0,
                "dx": 1,
                "dy": 1,
                "origin": "cell_center",
                "layout": "row_major",
                "x_wrap": "repeat",
                "y_mode": "clamp",
            },
            "encoding": {
                "id": artifact.encoding.id,
                "format": artifact.encoding.format,
                "dtype": artifact.encoding.dtype,
                "byte_order": artifact.encoding.byte_order,
            },
            "path": "legacy-artifact-path",
            "sha256": "b" * 64,
            "payload_file": f"{artifact_id}.field.{dtype_suffix}.bin",
            "frames": {
                frame_id: {
                    "path": (
                        f"runs/{dataset.id}/{cycle}/{DEFAULT_RUN_ID}/fields/"
                        f"{frame_id}/{artifact_id}.field.{dtype_suffix}.bin"
                    ),
                    "byte_length": len(artifact.component_ids) * 4,
                    "sha256": "a" * 64,
                }
                for frame_id in frames
            },
        }

    return {
        "schema": MANIFEST_SCHEMA,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "payload_contract": DATA_BINARY_CONTRACT,
        "dataset": {
            "id": dataset.id,
            "label": dataset.label,
        },
        "run": {
            "cycle": cycle,
            "run_id": DEFAULT_RUN_ID,
            "payload_root": f"runs/{dataset.id}/{cycle}/{DEFAULT_RUN_ID}/fields",
            "generated_at": "2026-05-16T00:00:00Z",
            "revision": f"{dataset.id}-{cycle}-revision",
        },
        "frames": [
            {"id": frame_id, "lead_hours": int(frame_id), "valid_at": f"2026-05-16T{int(frame_id):02d}:00:00Z"}
            for frame_id in frames
        ],
        "artifacts": artifacts,
    }


def _write_latest_pointer_manifest(repo: ArtifactRepository, *, dataset_id: str, manifest: dict) -> str:
    run = manifest["run"]
    cycle = str(run["cycle"])
    run_id = str(run["run_id"])
    revision = str(run["revision"])
    generated_at = str(run["generated_at"])
    public_uri = repo.write_public_run_manifest(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        manifest=manifest,
    )
    repo.write_latest_pointer(
        dataset_id=dataset_id,
        pointer=manifest_pointer_dict(
            schema_name=LATEST_POINTER_SCHEMA,
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            revision=revision,
            generated_at=generated_at,
            manifest_path=repo.paths.relative_key(public_uri),
        ),
    )
    return public_uri


class DataManifestTest(unittest.TestCase):
    def test_builds_layer_dataset_availability_from_config_and_latest_manifests(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-data-manifest-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )
            gfs = cfg.dataset("gfs")
            icon = cfg.dataset("icon")
            _write_latest_pointer_manifest(
                repo,
                dataset_id="gfs",
                manifest=_latest_manifest(
                    gfs,
                    cycle="2026051606",
                    artifact_ids=("tmp_surface", "wind10m_uv"),
                ),
            )
            _write_latest_pointer_manifest(
                repo,
                dataset_id="icon",
                manifest=_latest_manifest(
                    icon,
                    cycle="2026051606",
                    artifact_ids=("tmp_surface",),
                ),
            )

            manifest = build_data_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        self.assertEqual(manifest["schema"], FORECAST_MANIFEST_SCHEMA)
        self.assertEqual(manifest["schema_version"], FORECAST_MANIFEST_SCHEMA_VERSION)
        self.assertEqual(manifest["payload_contract"], DATA_BINARY_CONTRACT)
        self.assertEqual(manifest["catalog_version"], "test-forecast-catalog")
        self.assertNotIn("latest_cycle", manifest["datasets"]["gfs"])
        self.assertNotIn("latest_manifest_path", manifest["datasets"]["gfs"])
        latest = manifest["datasets"]["gfs"]["latest"]
        self.assertIsNotNone(latest)
        self.assertNotIn("schema", latest)
        self.assertNotIn("schema_version", latest)
        self.assertNotIn("payload_contract", latest)
        self.assertEqual(latest["run"]["cycle"], "2026051606")
        self.assertEqual(latest["frames"][0]["id"], "000")
        latest_artifact = latest["artifacts"]["tmp_surface"]
        self.assertEqual(latest_artifact["byte_length"], 4)
        self.assertEqual(latest_artifact["payload_file"], "tmp_surface.field.i16.bin")
        self.assertNotIn("frames", latest_artifact)
        self.assertNotIn("path", latest_artifact)
        self.assertNotIn("sha256", latest_artifact)

        native_scalar = manifest["layers"]["native_scalar"]["datasets"]
        self.assertEqual(native_scalar["gfs"]["state"], "available")
        self.assertEqual(native_scalar["gfs"]["support"], "native")

        unsupported_scalar = manifest["layers"]["unsupported_scalar"]["datasets"]
        self.assertEqual(unsupported_scalar["gfs"]["state"], "unsupported")
        self.assertEqual(unsupported_scalar["gfs"]["support"], "unavailable")
        self.assertEqual(unsupported_scalar["icon"]["state"], "temporarily_unavailable")

        etl_derived = manifest["layers"]["etl_derived"]["datasets"]
        self.assertEqual(etl_derived["gfs"]["state"], "temporarily_unavailable")
        self.assertEqual(etl_derived["gfs"]["support"], "etl-derived")

        frontend_derived = manifest["layers"]["frontend_derived"]["datasets"]
        self.assertEqual(frontend_derived["gfs"]["state"], "available")
        self.assertEqual(frontend_derived["gfs"]["support"], "frontend-derived")
        self.assertEqual(frontend_derived["gfs"]["required_artifacts"], ["wind10m_uv"])

        cloud_layers = manifest["layers"]["cloud_layers"]["datasets"]
        self.assertEqual(cloud_layers["gfs"]["state"], "temporarily_unavailable")
        self.assertEqual(cloud_layers["gfs"]["support"], "frontend-derived")
        self.assertEqual(cloud_layers["gfs"]["required_artifacts"], ["cloud_layers"])
        self.assertEqual(cloud_layers["icon"]["state"], "unsupported")

        top_level = manifest["layers"]["top_level_optional_overlay"]["datasets"]["gfs"]
        self.assertEqual(top_level["state"], "available")
        self.assertEqual(top_level["support"], "native")
        self.assertEqual(top_level["required_artifacts"], ["tmp_surface"])
        self.assertEqual(top_level["optional_artifacts"], ["precip_type_surface"])

    def test_builds_from_pointer_backed_latest_manifest(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-data-manifest-pointer-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )
            gfs = cfg.dataset("gfs")
            latest_manifest = _latest_manifest(gfs, cycle="2026051606", artifact_ids=("tmp_surface",))
            public_uri = repo.write_public_run_manifest(
                dataset_id="gfs",
                cycle="2026051606",
                run_id=DEFAULT_RUN_ID,
                manifest=latest_manifest,
            )
            repo.write_latest_pointer(
                dataset_id="gfs",
                pointer=manifest_pointer_dict(
                    schema_name=LATEST_POINTER_SCHEMA,
                    dataset_id="gfs",
                    cycle="2026051606",
                    run_id=DEFAULT_RUN_ID,
                    revision=latest_manifest["run"]["revision"],
                    generated_at=latest_manifest["run"]["generated_at"],
                    manifest_path=repo.paths.relative_key(public_uri),
                ),
            )

            manifest = build_data_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        latest = manifest["datasets"]["gfs"]["latest"]
        self.assertIsNotNone(latest)
        self.assertEqual(latest["run"]["cycle"], "2026051606")
        self.assertEqual(latest["run"]["run_id"], DEFAULT_RUN_ID)
        self.assertEqual(latest["artifacts"]["tmp_surface"]["payload_file"], "tmp_surface.field.i16.bin")
        self.assertEqual(manifest["layers"]["native_scalar"]["datasets"]["gfs"]["state"], "available")

    def test_sets_latest_to_null_when_latest_pointer_target_is_missing(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-data-manifest-missing-pointer-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )
            repo.write_latest_pointer(
                dataset_id="gfs",
                pointer=manifest_pointer_dict(
                    schema_name=LATEST_POINTER_SCHEMA,
                    dataset_id="gfs",
                    cycle="2026051606",
                    run_id=DEFAULT_RUN_ID,
                    revision="missing",
                    generated_at="2026-05-16T00:00:00Z",
                    manifest_path=f"manifests/gfs/cycles/2026051606/runs/{DEFAULT_RUN_ID}.json",
                ),
            )

            manifest = build_data_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        self.assertIsNone(manifest["datasets"]["gfs"]["latest"])
        self.assertEqual(
            manifest["layers"]["native_scalar"]["datasets"]["gfs"]["state"],
            "temporarily_unavailable",
        )

    def test_cloud_layers_layer_requires_vector_low_middle_high_components(self) -> None:
        cfg = _pipeline_config()

        cases = (
            ("valid", None, "available"),
            ("wrong_kind", {"kind": "scalar"}, "temporarily_unavailable"),
            ("wrong_components", {"components": ["low", "high", "middle"]}, "temporarily_unavailable"),
        )
        for case, mutation, expected_state in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory(
                prefix="weather-map-data-manifest-cloud-layers-"
            ) as td:
                repo = ArtifactRepository.for_root(
                    store=make_store(),
                    artifact_root_uri=f"file://{Path(td).as_posix()}",
                )
                gfs = cfg.dataset("gfs")
                latest_manifest = _latest_manifest(
                    gfs,
                    cycle="2026051606",
                    artifact_ids=("cloud_layers",),
                )
                if mutation is not None:
                    latest_manifest["artifacts"]["cloud_layers"].update(mutation)
                _write_latest_pointer_manifest(repo, dataset_id="gfs", manifest=latest_manifest)

                manifest = build_data_manifest(
                    pipeline_config=cfg,
                    artifact_repo=repo,
                    generated_at="2026-05-16T00:00:00Z",
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
                )

            entry = manifest["layers"]["cloud_layers"]["datasets"]["gfs"]
            self.assertEqual(entry["state"], expected_state)
            self.assertEqual(entry["support"], "frontend-derived")
            self.assertEqual(entry["required_artifacts"], ["cloud_layers"])

    def test_rejects_stale_raster_band_input(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-data-manifest-unsupported-raster-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )

            with self.assertRaisesRegex(SystemExit, "Raster source bands must not define 'input'"):
                build_data_manifest(
                    pipeline_config=cfg,
                    artifact_repo=repo,
                    generated_at="2026-05-16T00:00:00Z",
                    catalog={
                        "catalogVersion": "test-forecast-catalog",
                        "rasterLayers": [
                            {
                                "id": "unknown_input",
                                "source": {
                                    "artifactId": "cloud_layers",
                                    "bands": [
                                        {
                                            "id": "speed",
                                            "input": {"kind": "unknown-input"},
                                        }
                                    ],
                                },
                            }
                        ],
                    },
                )

    def test_rejects_invalid_overlay_source_shapes(self) -> None:
        cfg = _pipeline_config()

        cases = (
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
                "Raster source must define non-empty bands",
            ),
        )
        for case, overlay, expected_error in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory(
                prefix="weather-map-data-manifest-invalid-overlay-"
            ) as td:
                repo = ArtifactRepository.for_root(
                    store=make_store(),
                    artifact_root_uri=f"file://{Path(td).as_posix()}",
                )

                with self.assertRaisesRegex(SystemExit, expected_error):
                    build_data_manifest(
                        pipeline_config=cfg,
                        artifact_repo=repo,
                        generated_at="2026-05-16T00:00:00Z",
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
                    )

    def test_rejects_invalid_raster_source_shapes(self) -> None:
        cfg = _pipeline_config()

        cases = (
            ("missing", {"artifactId": "tmp_surface"}),
            ("empty", {"artifactId": "tmp_surface", "bands": []}),
        )
        for case, source in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory(
                prefix="weather-map-data-manifest-invalid-raster-"
            ) as td:
                repo = ArtifactRepository.for_root(
                    store=make_store(),
                    artifact_root_uri=f"file://{Path(td).as_posix()}",
                )

                with self.assertRaisesRegex(SystemExit, "Raster source must define non-empty bands"):
                    build_data_manifest(
                        pipeline_config=cfg,
                        artifact_repo=repo,
                        generated_at="2026-05-16T00:00:00Z",
                        catalog={
                            "catalogVersion": "test-forecast-catalog",
                            "rasterLayers": [
                                {
                                    "id": "invalid_raster",
                                    "source": source,
                                }
                            ],
                        },
                    )

    def test_sets_latest_to_null_when_no_latest_manifest_exists(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-data-manifest-no-latest-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )

            manifest = build_data_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        self.assertIsNone(manifest["datasets"]["gfs"]["latest"])
        self.assertIsNone(manifest["datasets"]["icon"]["latest"])

    def test_ignores_incompatible_latest_manifest_when_building_data_manifest(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-data-manifest-stale-latest-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )
            repo.store.write_bytes(
                uri=repo.paths.manifest_latest_uri(dataset_id="gfs"),
                data=(
                    json.dumps({
                    "schema": MANIFEST_SCHEMA,
                    "schema_version": MANIFEST_SCHEMA_VERSION,
                    "payload_contract": DATA_BINARY_CONTRACT,
                    "dataset": {"id": "gfs", "label": "GFS"},
                    "run": {
                        "cycle": "2026051606",
                        "generated_at": "2026-05-16T00:00:00Z",
                        "revision": "legacy-products-manifest",
                    },
                    "frames": [{"id": "000", "lead_hours": 0, "valid_at": "2026-05-16T00:00:00Z"}],
                    "products": {},
                    "groups": [],
                    }, sort_keys=True)
                    + "\n"
                ).encode("utf-8"),
            )

            manifest = build_data_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        self.assertIsNone(manifest["datasets"]["gfs"]["latest"])
        self.assertEqual(
            manifest["layers"]["native_scalar"]["datasets"]["gfs"]["state"],
            "temporarily_unavailable",
        )

    def test_ignores_latest_with_missing_or_inconsistent_frame_metadata(self) -> None:
        cfg = _pipeline_config()

        cases = (
            "missing",
            "inconsistent",
        )
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory(
                prefix="weather-map-data-manifest-invalid-latest-"
            ) as td:
                repo = ArtifactRepository.for_root(
                    store=make_store(),
                    artifact_root_uri=f"file://{Path(td).as_posix()}",
                )
                gfs = cfg.dataset("gfs")
                manifest = _latest_manifest(gfs, cycle="2026051606", artifact_ids=("tmp_surface",))
                if case == "missing":
                    del manifest["artifacts"]["tmp_surface"]["frames"]["003"]
                else:
                    manifest["artifacts"]["tmp_surface"]["frames"]["003"]["byte_length"] = 8
                _write_latest_pointer_manifest(repo, dataset_id="gfs", manifest=manifest)

                data_manifest = build_data_manifest(
                    pipeline_config=cfg,
                    artifact_repo=repo,
                    generated_at="2026-05-16T00:00:00Z",
                    catalog=_forecast_catalog(),
                )

            self.assertIsNone(data_manifest["datasets"]["gfs"]["latest"])
            self.assertEqual(
                data_manifest["layers"]["native_scalar"]["datasets"]["gfs"]["state"],
                "temporarily_unavailable",
            )


if __name__ == "__main__":
    unittest.main()
