from __future__ import annotations

import gzip
import json
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from weather_etl.config.pipeline import LoadedPipelineConfig, parse_pipeline_config
from weather_etl.config.product import LoadedProductConfig, build_loaded_product_config
from weather_etl.environment.context import ExecutionContext
from weather_etl.state.artifacts.identity import ArtifactWorkItem
from weather_etl.state.artifacts.paths import ArtifactPaths
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.state.manifest.public_view import DatasetViewPublishResult, publish_dataset_view
from weather_etl.state.manifest.publish import RunManifestPublishResult, publish_run_manifest
from weather_etl.state.runs.validation import PAYLOAD_CHECK_MODE, VALIDATION_SCHEMA, VALIDATION_SCHEMA_VERSION
from weather_etl.storage.base import UriStore
from weather_etl.storage.routing import make_store

from .artifact_configs import minimal_artifact_config
from .artifact_specs import artifact_specs_for_dataset
from .artifacts import DEFAULT_CODE_REVISION, DEFAULT_IMAGE_IDENTITY, DEFAULT_PRODUCT_CONFIG_DIGEST, DEFAULT_RUN_ID
from .catalog import catalog_for_artifact_configs
from .grids import grid_meta_fixture
from .markers import write_scalar_marker, write_vector_marker
from .pipeline import raw_pipeline_config


@dataclass(frozen=True)
class PublishFixture:
    artifact_root_uri: str
    cycle: str
    frames: tuple[str, ...]
    dataset_id: str
    dataset_label: str
    run_id: str
    ctx: ExecutionContext
    ap: ArtifactPaths
    store: UriStore
    grid_meta: dict[str, Any]

    @property
    def artifacts(self) -> ArtifactRepository:
        return ArtifactRepository.for_root(store=self.store, artifact_root_uri=self.artifact_root_uri)

    @property
    def cell_count(self) -> int:
        return int(self.grid_meta["nx"]) * int(self.grid_meta["ny"])

    def values(self, base: float = 0.0) -> list[float]:
        return [base + float(i) for i in range(self.cell_count)]

    def marker_uri(self, artifact_id: str, *, cycle: str | None = None, frame_id: str | None = None) -> str:
        return self.ap.success_marker_uri_parts(
            dataset_id=self.dataset_id,
            cycle=cycle or self.cycle,
            run_id=self.run_id,
            frame_id=frame_id or self.frames[0],
            artifact_id=artifact_id,
        )

    def write_scalar_marker(
        self,
        *,
        artifact_id: str = "tmp_surface",
        artifact_config: dict | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        frame_id: str | None = None,
        values: Sequence[float] | None = None,
        base: float = 0.0,
    ) -> None:
        write_scalar_marker(
            store=self.store,
            ap=self.ap,
            dataset_id=self.dataset_id,
            cycle=cycle or self.cycle,
            run_id=run_id or self.run_id,
            frame_id=frame_id or self.frames[0],
            artifact_id=artifact_id,
            source_values=list(values) if values is not None else self.values(base),
            artifact_config=artifact_config or minimal_artifact_config(),
            grid_meta=self.grid_meta,
        )

    def write_scalar_markers(
        self,
        *,
        artifact_id: str = "tmp_surface",
        artifact_config: dict | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        base: float = 0.0,
    ) -> None:
        for frame_id in self.frames:
            self.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_config,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
                base=base,
            )

    def write_vector_marker(
        self,
        *,
        artifact_id: str = "wind10m_uv",
        artifact_config: dict | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        frame_id: str | None = None,
    ) -> None:
        write_vector_marker(
            store=self.store,
            ap=self.ap,
            dataset_id=self.dataset_id,
            cycle=cycle or self.cycle,
            run_id=run_id or self.run_id,
            frame_id=frame_id or self.frames[0],
            artifact_id=artifact_id,
            grid_meta=self.grid_meta,
            artifact_config=artifact_config,
        )

    def write_vector_markers(
        self,
        *,
        artifact_id: str = "wind10m_uv",
        artifact_config: dict | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
    ) -> None:
        for frame_id in self.frames:
            self.write_vector_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_config,
                cycle=cycle,
                run_id=run_id,
                frame_id=frame_id,
            )

    def publish(
        self,
        *,
        artifact_ids: Sequence[str],
        artifacts_cfg: dict[str, dict],
        product_config: LoadedProductConfig | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        auto_validate: bool = True,
        publish_view: bool = True,
    ) -> RunManifestPublishResult:
        if auto_validate:
            self.write_passing_validation(cycle=cycle, run_id=run_id, artifact_ids=artifact_ids)
        product_config = product_config or self.product_config_for(
            artifact_ids=artifact_ids,
            artifacts_cfg=artifacts_cfg,
        )
        result = publish_run_manifest(
            dataset_label=self.dataset_label,
            ctx=self.ctx,
            cycle=cycle or self.cycle,
            run_id=run_id,
            artifact_ids=tuple(artifact_ids),
            artifact_specs=artifact_specs_for_dataset(dataset_id=self.dataset_id, raw_artifacts=artifacts_cfg),
            artifact_repo=self.artifacts,
        )
        if result.ready and publish_view:
            self.refresh_view(
                product_config=product_config,
                cycle=cycle or self.cycle,
                run_id=result.run_id or run_id or self.run_id,
            )
        return result

    def refresh_view(
        self,
        *,
        product_config: LoadedProductConfig,
        cycle: str | None = None,
        run_id: str | None = None,
    ) -> DatasetViewPublishResult:
        return publish_dataset_view(
            product_config=product_config,
            artifact_repo=self.artifacts,
            dataset_id=self.dataset_id,
            cycle=cycle or self.cycle,
            run_id=run_id or self.run_id,
        )

    def product_config_for(
        self,
        *,
        artifact_ids: Sequence[str],
        artifacts_cfg: dict[str, dict],
    ) -> LoadedProductConfig:
        frame_hours = tuple(int(frame_id) for frame_id in self.frames)
        loaded = _loaded_pipeline_config_for_publish(
            dataset_id=self.dataset_id,
            artifact_ids=artifact_ids,
            artifacts_cfg=artifacts_cfg,
            frame_start=min(frame_hours),
            frame_end=max(frame_hours),
        )
        return build_loaded_product_config(
            loaded_pipeline_config=loaded,
            catalog=catalog_for_artifact_configs(
                artifacts_cfg,
                artifact_ids=artifact_ids,
            ),
        )

    def write_passing_validation(
        self,
        *,
        cycle: str | None = None,
        run_id: str | None = None,
        artifact_ids: Sequence[str],
    ) -> str:
        resolved_cycle = cycle or self.cycle
        resolved_run_id = run_id or self.run_id
        return self.artifacts.write_validation_report(
            dataset_id=self.dataset_id,
            cycle=resolved_cycle,
            run_id=resolved_run_id,
            report={
                "schema": VALIDATION_SCHEMA,
                "schema_version": VALIDATION_SCHEMA_VERSION,
                "dataset_id": self.dataset_id,
                "cycle": resolved_cycle,
                "run_id": resolved_run_id,
                "generated_at": "2026-04-11T01:00:00+00:00",
                "status": "passed",
                "payload_check_mode": PAYLOAD_CHECK_MODE,
                "product_config_digest": DEFAULT_PRODUCT_CONFIG_DIGEST,
                "expected": {
                    "frames": list(self.frames),
                    "artifacts": list(artifact_ids),
                    "marker_count": len(self.frames) * len(artifact_ids),
                },
                "observed": {
                    "expected_markers": len(self.frames) * len(artifact_ids),
                    "unexpected_markers": 0,
                    "total_markers": len(self.frames) * len(artifact_ids),
                },
                "errors": [],
                "warnings": [],
            },
        )

    def write_failed_validation(self, *, artifact_ids: Sequence[str], error: str = "failed") -> str:
        uri = self.write_passing_validation(artifact_ids=artifact_ids)
        report = self.artifacts.read_validation_report(dataset_id=self.dataset_id, cycle=self.cycle, run_id=self.run_id)
        report["status"] = "failed"
        report["errors"] = [error]
        self.artifacts.write_validation_report(dataset_id=self.dataset_id, cycle=self.cycle, run_id=self.run_id, report=report)
        return uri

    def cycle_manifest(self, *, cycle: str | None = None) -> dict[str, Any]:
        uri = self.ap.public_run_manifest_uri(
            dataset_id=self.dataset_id,
            cycle=cycle or self.cycle,
            run_id=self.run_id,
        )
        return json.loads(self.store.read_bytes(uri=uri).decode("utf-8"))

    def latest_manifest(self) -> dict[str, Any]:
        return json.loads(self.store.read_bytes(uri=self.ap.latest_manifest_uri(dataset_id=self.dataset_id)).decode("utf-8"))

    def current_manifest(self, *, cycle: str | None = None) -> dict[str, Any]:
        return json.loads(
            self.store.read_bytes(
                uri=self.ap.cycle_current_manifest_uri(dataset_id=self.dataset_id, cycle=cycle or self.cycle)
            ).decode("utf-8")
        )

    def payload_bytes(self, *, artifact_id: str, frame_id: str, dtype: str, cycle: str | None = None) -> bytes:
        payload_uri = self.ap.payload_uri(
            item=ArtifactWorkItem(
                dataset_id=self.dataset_id,
                cycle=cycle or self.cycle,
                run_id=self.run_id,
                frame_id=frame_id,
                artifact_id=artifact_id,
                source_uri="file:///dev/null",
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
            ),
            dtype=dtype,
        )
        return gzip.decompress(self.store.read_bytes(uri=payload_uri))

def _loaded_pipeline_config_for_publish(
    *,
    dataset_id: str,
    artifact_ids: Sequence[str],
    artifacts_cfg: dict[str, dict],
    frame_start: int,
    frame_end: int,
) -> LoadedPipelineConfig:
    raw = raw_pipeline_config(
        dataset_ids=(dataset_id,),
        frame_start=frame_start,
        frame_end=frame_end,
        artifacts=tuple(artifact_ids),
        artifact_configs={artifact_id: artifacts_cfg[artifact_id] for artifact_id in artifact_ids},
    )
    return LoadedPipelineConfig(raw=raw, config=parse_pipeline_config(raw))


@contextmanager
def publish_fixture(
    *,
    prefix: str = "weather-map-publish-",
    dataset_id: str = "gfs",
    dataset_label: str = "GFS",
    cycle: str = "2026041100",
    frames: tuple[str, ...] = ("000",),
) -> Iterator[PublishFixture]:
    with tempfile.TemporaryDirectory(prefix=prefix) as td:
        root_dir = Path(td) / "out"
        artifact_root_uri = f"file://{root_dir.as_posix()}"
        yield PublishFixture(
            artifact_root_uri=artifact_root_uri,
            cycle=cycle,
            frames=frames,
            dataset_id=dataset_id,
            dataset_label=dataset_label,
            run_id=DEFAULT_RUN_ID,
            ctx=ExecutionContext(
                dataset_id=dataset_id,
                artifact_root_uri=artifact_root_uri,
                frames=frames,
            ),
            ap=ArtifactPaths(artifact_root_uri),
            store=make_store(),
            grid_meta=grid_meta_fixture(),
        )
