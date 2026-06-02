from __future__ import annotations

from types import SimpleNamespace

from forecast_etl.config.load import LoadedPipelineConfig
from forecast_etl.config.resolved import (
    GfsNomadsSourceConfig,
    IconDwdSourceConfig,
    NomadsConfig,
)
from forecast_etl.run_snapshots import LoadedRunSnapshot
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


class FakeWorkload:
    def __init__(self, *, frames: tuple[str, ...], artifacts: tuple[str, ...]) -> None:
        self.frames = frames
        self.artifacts = artifacts


class FakePipelineConfig:
    def __init__(
        self,
        *,
        frames: tuple[str, ...] = ("000", "003"),
        artifacts: tuple[str, ...] = ("tmp_surface",),
        dataset_ids: tuple[str, ...] = ("gfs",),
        rate_limit_seconds: float = 0.0,
    ) -> None:
        self.workload = FakeWorkload(frames=frames, artifacts=artifacts)
        self.source: GfsNomadsSourceConfig | IconDwdSourceConfig = GfsNomadsSourceConfig(
            grid_id="gfs_0p25",
            nomads=NomadsConfig(
                base_url="https://example.test/filter",
                vars_levels={"all_var": "on"},
                rate_limit_seconds=rate_limit_seconds,
            )
        )
        self.nomads = self.source.nomads
        self.artifacts = {name: {"kind": "scalar"} for name in artifacts}
        self.id = "gfs"
        self.label = "GFS"
        self.datasets = {dataset_id: self for dataset_id in dataset_ids}

    def dataset(self, dataset_id: str) -> "FakePipelineConfig":
        dataset = self.datasets.get(dataset_id)
        if dataset is None:
            raise SystemExit(f"Unknown dataset {dataset_id!r}")
        return dataset

    def model_dump(self, *, mode: str = "json") -> dict:
        del mode
        return {
            "datasets": {
                dataset_id: {
                    "id": dataset.id,
                    "workload": {
                        "frames": dataset.workload.frames,
                        "artifacts": dataset.workload.artifacts,
                    },
                }
                for dataset_id, dataset in self.datasets.items()
            }
        }


class FakePool:
    def __init__(self, *, processes=None) -> None:
        self.processes = processes

    def __enter__(self) -> "FakePool":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def imap_unordered(self, fn, iterable):
        for item in iterable:
            yield fn(item)


def loaded_cfg(cfg: FakePipelineConfig) -> LoadedPipelineConfig:
    return LoadedPipelineConfig(raw=cfg.model_dump(mode="json"), config=cfg)


def loaded_run_snapshot(cfg: FakePipelineConfig) -> LoadedRunSnapshot:
    return LoadedRunSnapshot(
        run_id=DEFAULT_RUN_ID,
        config_digest="sha256:" + "1" * 64,
        pipeline_config_uri=f"file:///artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        forecast_catalog_uri=f"file:///artifacts/runs/gfs/2026021300/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
        loaded_config=loaded_cfg(cfg),
        forecast_catalog={"catalogVersion": "test", "rasterLayers": []},
    )


def passed_validation():
    return SimpleNamespace(passed=True, errors=(), warnings=())
