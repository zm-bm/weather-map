from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Iterable

from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.config.load import load_pipeline_config
from forecast_etl.config.resolved import ModelConfig, PipelineConfig
from forecast_etl.manifest.availability import (
    AVAILABILITY_INDEX_SCHEMA,
    AVAILABILITY_INDEX_SCHEMA_VERSION,
    build_availability_index,
)
from forecast_etl.storage.routing import make_store


def _pipeline_config() -> PipelineConfig:
    repo_root = Path(__file__).resolve().parents[3]
    return load_pipeline_config(
        (repo_root / "config" / "pipeline" / "base.json").as_uri(),
        overlay_uri=(repo_root / "config" / "pipeline" / "local.json").as_uri(),
    )


def _latest_manifest(model: ModelConfig, *, cycle: str, artifact_ids: Iterable[str]) -> dict:
    artifacts = {}
    for artifact_id in artifact_ids:
        artifact = model.artifacts[artifact_id]
        artifacts[artifact_id] = {
            "id": artifact_id,
            "kind": artifact.kind,
            "components": list(artifact.component_ids),
        }

    return {
        "model": {
            "id": model.id,
            "label": model.label,
        },
        "run": {
            "cycle": cycle,
        },
        "artifacts": artifacts,
    }


class AvailabilityIndexTest(unittest.TestCase):
    def test_builds_layer_model_availability_from_config_and_latest_manifests(self) -> None:
        cfg = _pipeline_config()

        with tempfile.TemporaryDirectory(prefix="weather-map-availability-") as td:
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

            index = build_availability_index(
                pipeline_config=cfg,
                artifact_repo=repo,
                generated_at="2026-05-16T00:00:00Z",
            )

        self.assertEqual(index["schema"], AVAILABILITY_INDEX_SCHEMA)
        self.assertEqual(index["schemaVersion"], AVAILABILITY_INDEX_SCHEMA_VERSION)
        self.assertEqual(index["catalogVersion"], "forecast-catalog-v1")
        self.assertEqual(index["models"]["gfs"]["latestCycle"], "2026051606")
        self.assertEqual(index["models"]["gfs"]["latestManifestPath"], "manifests/gfs/latest.json")

        visibility = index["layers"]["visibility"]["models"]
        self.assertEqual(visibility["gfs"]["state"], "available")
        self.assertEqual(visibility["gfs"]["support"], "native")
        self.assertEqual(visibility["gfs"]["requiredArtifacts"], ["visibility_surface"])
        self.assertEqual(visibility["icon"]["state"], "unsupported")
        self.assertEqual(visibility["icon"]["support"], "unavailable")

        accumulated_precipitation = index["layers"]["accumulated_precipitation"]["models"]
        self.assertEqual(accumulated_precipitation["gfs"]["state"], "unsupported")
        self.assertEqual(accumulated_precipitation["icon"]["state"], "available")
        self.assertEqual(accumulated_precipitation["icon"]["requiredArtifacts"], ["precip_total_surface"])

        cape = index["layers"]["cape"]["models"]
        self.assertEqual(cape["icon"]["state"], "temporarily_unavailable")
        self.assertEqual(cape["icon"]["requiredArtifacts"], ["cape_index"])

        precipitation_rate = index["layers"]["precipitation_rate"]["models"]
        self.assertEqual(precipitation_rate["icon"]["state"], "available")
        self.assertEqual(precipitation_rate["icon"]["support"], "composite")
        self.assertEqual(precipitation_rate["icon"]["requiredArtifacts"], ["prate_surface"])
        self.assertEqual(precipitation_rate["icon"]["optionalArtifacts"], ["precip_type_surface"])


if __name__ == "__main__":
    unittest.main()
