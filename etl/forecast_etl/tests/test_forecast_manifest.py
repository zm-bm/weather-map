from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Iterable

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.config.load import parse_pipeline_config
from forecast_etl.config.resolved import ModelConfig, PipelineConfig
from forecast_etl.manifest.constants import (
    FORECAST_BINARY_CONTRACT,
    MANIFEST_SCHEMA,
    MANIFEST_SCHEMA_VERSION,
)
from forecast_etl.manifest.forecast_manifest import (
    FORECAST_MANIFEST_SCHEMA,
    FORECAST_MANIFEST_SCHEMA_VERSION,
    build_forecast_manifest,
)
from forecast_etl.storage.routing import make_store
from forecast_etl.tests.fixtures.artifact_configs import (
    minimal_artifact_config,
    precip_rate_config,
    precip_type_config,
    wind_artifact_config,
)
from forecast_etl.tests.fixtures.pipeline import catalog_artifact, minimal_pipeline_config, model_artifact


def _pipeline_config() -> PipelineConfig:
    tmp = minimal_artifact_config()
    precip_rate = precip_rate_config()
    precip_type = precip_type_config()
    wind = wind_artifact_config()
    cfg = minimal_pipeline_config()
    cfg["artifact_catalog"].update(
        {
            "prate_surface": catalog_artifact(precip_rate),
            "precip_type_surface": catalog_artifact(precip_type),
            "wind10m_uv": catalog_artifact(wind),
        }
    )
    cfg["models"]["gfs"]["workload"]["artifacts"] = [
        "tmp_surface",
        "precip_type_surface",
        "wind10m_uv",
    ]
    cfg["models"]["gfs"]["artifacts"] = {
        "tmp_surface": model_artifact(tmp),
        "precip_type_surface": model_artifact(precip_type),
        "wind10m_uv": model_artifact(wind),
    }
    cfg["models"]["icon"] = {
        "label": "ICON",
        "source": {
            "type": "icon_dwd_icosahedral",
            "grid_id": "icon_global_regridded_0p125",
            "base_url": "https://example.test/icon",
            "rate_limit_seconds": 0.0,
        },
        "workload": {
            "forecast_hour_start": 0,
            "forecast_hour_end": 0,
            "artifacts": ["tmp_surface", "prate_surface"],
        },
        "artifacts": {
            "tmp_surface": {
                "components": [{"id": "value", "grib_match": {"ICON_PARAM": "t_2m"}}],
            },
            "prate_surface": model_artifact(precip_rate),
        },
    }
    return parse_pipeline_config(cfg)


def _forecast_catalog() -> dict:
    return {
        "catalogVersion": "test-forecast-catalog",
        "layers": [
            {"id": "native_scalar", "source": {"kind": "artifact", "artifactId": "tmp_surface"}},
            {"id": "unsupported_scalar", "source": {"kind": "artifact", "artifactId": "prate_surface"}},
            {"id": "etl_derived", "source": {"kind": "artifact", "artifactId": "precip_type_surface"}},
            {
                "id": "frontend_derived",
                "source": {"kind": "derived", "artifactId": "wind10m_uv", "recipe": "wind-speed"},
            },
            {
                "id": "composite_with_optional_overlay",
                "source": {
                    "kind": "composite",
                    "base": {"kind": "artifact", "artifactId": "tmp_surface"},
                    "overlays": [
                        {
                            "source": {"kind": "artifact", "artifactId": "precip_type_surface"},
                            "optional": True,
                        }
                    ],
                },
            },
        ],
    }


def _latest_manifest(model: ModelConfig, *, cycle: str, artifact_ids: Iterable[str]) -> dict:
    fhours = ("000", "003")
    artifacts = {}
    for artifact_id in artifact_ids:
        artifact = model.artifacts[artifact_id]
        dtype_suffix = "i16" if artifact.encoding.dtype == "int16" else "i8"
        artifacts[artifact_id] = {
            "id": artifact_id,
            "kind": artifact.kind,
            "units": artifact.units,
            "parameter": artifact.parameter,
            "level": artifact.level,
            "components": list(artifact.component_ids),
            "grid": {
                "id": model.source.grid_id,
                "crs": "EPSG:4326",
                "nx": 2,
                "ny": 2,
                "lon0": 0,
                "lat0": 0,
                "dx": 1,
                "dy": 1,
                "origin": "cell_center",
                "layout": "row_major",
                "xWrap": "repeat",
                "yMode": "clamp",
            },
            "encoding": {
                "id": artifact.encoding.id,
                "format": artifact.encoding.format,
                "dtype": artifact.encoding.dtype,
                "byteOrder": artifact.encoding.byte_order,
            },
            "path": "legacy-artifact-path",
            "sha256": "b" * 64,
            "frames": {
                fhour: {
                    "path": f"fields/{model.id}/{cycle}/{fhour}/{artifact_id}.field.{dtype_suffix}.bin",
                    "byteLength": len(artifact.component_ids) * 4,
                    "sha256": "a" * 64,
                }
                for fhour in fhours
            },
        }

    return {
        "schema": MANIFEST_SCHEMA,
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "payloadContract": FORECAST_BINARY_CONTRACT,
        "model": {
            "id": model.id,
            "label": model.label,
        },
        "run": {
            "cycle": cycle,
            "generatedAt": "2026-05-16T00:00:00Z",
            "revision": f"{model.id}-{cycle}-revision",
        },
        "times": [
            {"id": fhour, "leadHours": int(fhour), "validAt": f"2026-05-16T{int(fhour):02d}:00:00Z"}
            for fhour in fhours
        ],
        "artifacts": artifacts,
    }


class ForecastManifestTest(unittest.TestCase):
    def test_builds_layer_model_availability_from_config_and_latest_manifests(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-forecast-manifest-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )
            gfs = cfg.model("gfs")
            icon = cfg.model("icon")
            repo.write_latest_manifest(
                model_id="gfs",
                manifest=_latest_manifest(
                    gfs,
                    cycle="2026051606",
                    artifact_ids=("tmp_surface", "wind10m_uv"),
                ),
            )
            repo.write_latest_manifest(
                model_id="icon",
                manifest=_latest_manifest(
                    icon,
                    cycle="2026051606",
                    artifact_ids=("tmp_surface",),
                ),
            )

            manifest = build_forecast_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        self.assertEqual(manifest["schema"], FORECAST_MANIFEST_SCHEMA)
        self.assertEqual(manifest["schemaVersion"], FORECAST_MANIFEST_SCHEMA_VERSION)
        self.assertEqual(manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
        self.assertEqual(manifest["catalogVersion"], "test-forecast-catalog")
        self.assertNotIn("latestCycle", manifest["models"]["gfs"])
        self.assertNotIn("latestManifestPath", manifest["models"]["gfs"])
        latest = manifest["models"]["gfs"]["latest"]
        self.assertIsNotNone(latest)
        self.assertNotIn("schema", latest)
        self.assertNotIn("schemaVersion", latest)
        self.assertNotIn("payloadContract", latest)
        self.assertEqual(latest["run"]["cycle"], "2026051606")
        self.assertEqual(latest["times"][0]["id"], "000")
        latest_artifact = latest["artifacts"]["tmp_surface"]
        self.assertEqual(latest_artifact["byteLength"], 4)
        self.assertNotIn("frames", latest_artifact)
        self.assertNotIn("path", latest_artifact)
        self.assertNotIn("sha256", latest_artifact)

        native_scalar = manifest["layers"]["native_scalar"]["models"]
        self.assertEqual(native_scalar["gfs"]["state"], "available")
        self.assertEqual(native_scalar["gfs"]["support"], "native")

        unsupported_scalar = manifest["layers"]["unsupported_scalar"]["models"]
        self.assertEqual(unsupported_scalar["gfs"]["state"], "unsupported")
        self.assertEqual(unsupported_scalar["gfs"]["support"], "unavailable")
        self.assertEqual(unsupported_scalar["icon"]["state"], "temporarily_unavailable")

        etl_derived = manifest["layers"]["etl_derived"]["models"]
        self.assertEqual(etl_derived["gfs"]["state"], "temporarily_unavailable")
        self.assertEqual(etl_derived["gfs"]["support"], "etl-derived")

        frontend_derived = manifest["layers"]["frontend_derived"]["models"]
        self.assertEqual(frontend_derived["gfs"]["state"], "available")
        self.assertEqual(frontend_derived["gfs"]["support"], "frontend-derived")
        self.assertEqual(frontend_derived["gfs"]["requiredArtifacts"], ["wind10m_uv"])

        composite = manifest["layers"]["composite_with_optional_overlay"]["models"]["gfs"]
        self.assertEqual(composite["state"], "available")
        self.assertEqual(composite["support"], "composite")
        self.assertEqual(composite["requiredArtifacts"], ["tmp_surface"])
        self.assertEqual(composite["optionalArtifacts"], ["precip_type_surface"])

    def test_sets_latest_to_null_when_no_latest_manifest_exists(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-forecast-manifest-no-latest-") as td:
            repo = ArtifactRepository.for_root(
                store=make_store(),
                artifact_root_uri=f"file://{Path(td).as_posix()}",
            )

            manifest = build_forecast_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
                catalog=_forecast_catalog(),
            )

        self.assertIsNone(manifest["models"]["gfs"]["latest"])
        self.assertIsNone(manifest["models"]["icon"]["latest"])

    def test_rejects_embedded_latest_with_missing_or_inconsistent_frame_metadata(self) -> None:
        cfg = _pipeline_config()

        cases = (
            ("missing", "must be an object"),
            ("inconsistent", "byteLength mismatch"),
        )
        for case, expected_error in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory(
                prefix="weather-map-forecast-manifest-invalid-latest-"
            ) as td:
                repo = ArtifactRepository.for_root(
                    store=make_store(),
                    artifact_root_uri=f"file://{Path(td).as_posix()}",
                )
                gfs = cfg.model("gfs")
                manifest = _latest_manifest(gfs, cycle="2026051606", artifact_ids=("tmp_surface",))
                if case == "missing":
                    del manifest["artifacts"]["tmp_surface"]["frames"]["003"]
                else:
                    manifest["artifacts"]["tmp_surface"]["frames"]["003"]["byteLength"] = 8
                repo.write_latest_manifest(model_id="gfs", manifest=manifest)

                with self.assertRaisesRegex(SystemExit, expected_error):
                    build_forecast_manifest(
                        pipeline_config=cfg,
                        artifact_repo=repo,
                        generated_at="2026-05-16T00:00:00Z",
                        catalog=_forecast_catalog(),
                    )


if __name__ == "__main__":
    unittest.main()
