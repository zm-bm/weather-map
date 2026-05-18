from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Iterable

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.config.load import load_pipeline_config
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


def _pipeline_config() -> PipelineConfig:
    repo_root = Path(__file__).resolve().parents[3]
    return load_pipeline_config(
        (repo_root / "config" / "pipeline" / "base.json").as_uri(),
        overlay_uri=(repo_root / "config" / "pipeline" / "local.json").as_uri(),
    )


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
                manifest=_latest_manifest(gfs, cycle="2026051606", artifact_ids=gfs.workload.artifacts),
            )
            repo.write_latest_manifest(
                model_id="icon",
                manifest=_latest_manifest(
                    icon,
                    cycle="2026051606",
                    artifact_ids=(
                        artifact_id
                        for artifact_id in icon.workload.artifacts
                        if artifact_id not in {"cape_index", "precip_type_surface"}
                    ),
                ),
            )

            manifest = build_forecast_manifest(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
            )

        self.assertEqual(manifest["schema"], FORECAST_MANIFEST_SCHEMA)
        self.assertEqual(manifest["schemaVersion"], FORECAST_MANIFEST_SCHEMA_VERSION)
        self.assertEqual(manifest["payloadContract"], FORECAST_BINARY_CONTRACT)
        self.assertEqual(manifest["catalogVersion"], "forecast-catalog-v1")
        self.assertNotIn("latestCycle", manifest["models"]["gfs"])
        self.assertNotIn("latestManifestPath", manifest["models"]["gfs"])
        latest = manifest["models"]["gfs"]["latest"]
        self.assertIsNotNone(latest)
        self.assertNotIn("schema", latest)
        self.assertNotIn("schemaVersion", latest)
        self.assertNotIn("payloadContract", latest)
        self.assertEqual(latest["run"]["cycle"], "2026051606")
        self.assertEqual(latest["times"][0]["id"], "000")
        temperature_artifact = latest["artifacts"]["tmp_surface"]
        self.assertEqual(temperature_artifact["byteLength"], 4)
        self.assertNotIn("frames", temperature_artifact)
        self.assertNotIn("path", temperature_artifact)
        self.assertNotIn("sha256", temperature_artifact)

        visibility = manifest["layers"]["visibility"]["models"]
        self.assertEqual(visibility["gfs"]["state"], "available")
        self.assertEqual(visibility["gfs"]["support"], "native")
        self.assertEqual(visibility["gfs"]["requiredArtifacts"], ["visibility_surface"])
        self.assertEqual(visibility["icon"]["state"], "unsupported")
        self.assertEqual(visibility["icon"]["support"], "unavailable")

        accumulated_precipitation = manifest["layers"]["accumulated_precipitation"]["models"]
        self.assertEqual(accumulated_precipitation["gfs"]["state"], "unsupported")
        self.assertEqual(accumulated_precipitation["icon"]["state"], "available")
        self.assertEqual(accumulated_precipitation["icon"]["requiredArtifacts"], ["precip_total_surface"])

        cape = manifest["layers"]["cape"]["models"]
        self.assertEqual(cape["icon"]["state"], "temporarily_unavailable")
        self.assertEqual(cape["icon"]["requiredArtifacts"], ["cape_index"])

        precipitation_rate = manifest["layers"]["precipitation_rate"]["models"]
        self.assertEqual(precipitation_rate["icon"]["state"], "available")
        self.assertEqual(precipitation_rate["icon"]["support"], "composite")
        self.assertEqual(precipitation_rate["icon"]["requiredArtifacts"], ["prate_surface"])
        self.assertEqual(precipitation_rate["icon"]["optionalArtifacts"], ["precip_type_surface"])

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
                    )


if __name__ == "__main__":
    unittest.main()
