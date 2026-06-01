from __future__ import annotations

import gzip
import json
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.config.resolved import PipelineConfig
from forecast_etl.manifest.publish import PublishResult, run_publish
from forecast_etl.run_validation import PAYLOAD_CHECK_MODE, VALIDATION_SCHEMA, VALIDATION_SCHEMA_VERSION
from forecast_etl.runtime import ExecutionContext
from forecast_etl.storage.base import UriStore
from forecast_etl.storage.routing import make_store

from .artifact_configs import artifact_specs, minimal_artifact_config
from .artifacts import DEFAULT_CODE_REVISION, DEFAULT_CONFIG_DIGEST, DEFAULT_IMAGE_IDENTITY, DEFAULT_RUN_ID
from .grids import grid_meta_fixture
from .markers import write_scalar_marker, write_vector_marker


@dataclass(frozen=True)
class PublishFixture:
    artifact_root_uri: str
    cycle: str
    fhours: tuple[str, ...]
    model_id: str
    model_label: str
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

    def marker_uri(self, artifact_id: str, *, cycle: str | None = None, fhour: str | None = None) -> str:
        return self.ap.success_marker_uri_parts(
            model_id=self.model_id,
            cycle=cycle or self.cycle,
            run_id=self.run_id,
            fhour=fhour or self.fhours[0],
            artifact_id=artifact_id,
        )

    def write_scalar_marker(
        self,
        *,
        artifact_id: str = "tmp_surface",
        artifact_config: dict | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        fhour: str | None = None,
        values: Sequence[float] | None = None,
        base: float = 0.0,
    ) -> None:
        write_scalar_marker(
            store=self.store,
            ap=self.ap,
            cycle=cycle or self.cycle,
            run_id=run_id or self.run_id,
            fhour=fhour or self.fhours[0],
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
        for fhour in self.fhours:
            self.write_scalar_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_config,
                cycle=cycle,
                run_id=run_id,
                fhour=fhour,
                base=base,
            )

    def write_vector_marker(
        self,
        *,
        artifact_id: str = "wind10m_uv",
        artifact_config: dict | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        fhour: str | None = None,
    ) -> None:
        write_vector_marker(
            store=self.store,
            ap=self.ap,
            cycle=cycle or self.cycle,
            run_id=run_id or self.run_id,
            fhour=fhour or self.fhours[0],
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
        for fhour in self.fhours:
            self.write_vector_marker(
                artifact_id=artifact_id,
                artifact_config=artifact_config,
                cycle=cycle,
                run_id=run_id,
                fhour=fhour,
            )

    def publish(
        self,
        *,
        artifact_ids: Sequence[str],
        artifacts_cfg: dict[str, dict],
        pipeline_config: PipelineConfig | None = None,
        cycle: str | None = None,
        run_id: str | None = None,
        auto_validate: bool = True,
    ) -> PublishResult:
        if auto_validate:
            self.write_passing_validation(cycle=cycle, run_id=run_id, artifact_ids=artifact_ids)
        return run_publish(
            model_label=self.model_label,
            ctx=self.ctx,
            cycle=cycle or self.cycle,
            run_id=run_id,
            artifact_ids=tuple(artifact_ids),
            artifact_specs=artifact_specs(artifacts_cfg),
            artifact_repo=self.artifacts,
            pipeline_config=pipeline_config,
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
            model_id=self.model_id,
            cycle=resolved_cycle,
            run_id=resolved_run_id,
            report={
                "schema": VALIDATION_SCHEMA,
                "schemaVersion": VALIDATION_SCHEMA_VERSION,
                "model": self.model_id,
                "cycle": resolved_cycle,
                "runId": resolved_run_id,
                "generatedAt": "2026-04-11T01:00:00+00:00",
                "status": "passed",
                "payloadCheckMode": PAYLOAD_CHECK_MODE,
                "configDigest": DEFAULT_CONFIG_DIGEST,
                "expected": {
                    "forecastHours": list(self.fhours),
                    "artifacts": list(artifact_ids),
                    "markerCount": len(self.fhours) * len(artifact_ids),
                },
                "observed": {
                    "expectedMarkers": len(self.fhours) * len(artifact_ids),
                    "unexpectedMarkers": 0,
                    "totalMarkers": len(self.fhours) * len(artifact_ids),
                },
                "errors": [],
                "warnings": [],
            },
        )

    def write_failed_validation(self, *, artifact_ids: Sequence[str], error: str = "failed") -> str:
        uri = self.write_passing_validation(artifact_ids=artifact_ids)
        report = self.artifacts.read_validation_report(model_id=self.model_id, cycle=self.cycle, run_id=self.run_id)
        report["status"] = "failed"
        report["errors"] = [error]
        self.artifacts.write_validation_report(model_id=self.model_id, cycle=self.cycle, run_id=self.run_id, report=report)
        return uri

    def cycle_manifest(self, *, cycle: str | None = None) -> dict[str, Any]:
        uri = self.ap.public_run_manifest_uri(
            model_id=self.model_id,
            cycle=cycle or self.cycle,
            run_id=self.run_id,
        )
        return json.loads(self.store.read_bytes(uri=uri).decode("utf-8"))

    def latest_manifest(self) -> dict[str, Any]:
        pointer = self.latest_pointer()
        uri = f"{self.artifact_root_uri.rstrip('/')}/{pointer['manifestPath']}"
        return json.loads(self.store.read_bytes(uri=uri).decode("utf-8"))

    def latest_pointer(self) -> dict[str, Any]:
        return json.loads(self.store.read_bytes(uri=self.ap.manifest_latest_uri(model_id=self.model_id)).decode("utf-8"))

    def current_pointer(self, *, cycle: str | None = None) -> dict[str, Any]:
        return json.loads(
            self.store.read_bytes(
                uri=self.ap.cycle_current_pointer_uri(model_id=self.model_id, cycle=cycle or self.cycle)
            ).decode("utf-8")
        )

    def payload_bytes(self, *, artifact_id: str, fhour: str, dtype: str, cycle: str | None = None) -> bytes:
        payload_uri = self.ap.output_field_payload_uri(
            item=WorkItem(
                model_id=self.model_id,
                cycle=cycle or self.cycle,
                run_id=self.run_id,
                fhour=fhour,
                artifact_id=artifact_id,
                source_uri="file:///dev/null",
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                config_digest=DEFAULT_CONFIG_DIGEST,
            ),
            dtype=dtype,
        )
        return gzip.decompress(self.store.read_bytes(uri=payload_uri))


@contextmanager
def publish_fixture(
    *,
    prefix: str = "weather-map-publish-",
    model_id: str = "gfs",
    model_label: str = "GFS",
    cycle: str = "2026041100",
    fhours: tuple[str, ...] = ("000",),
) -> Iterator[PublishFixture]:
    with tempfile.TemporaryDirectory(prefix=prefix) as td:
        root_dir = Path(td) / "out"
        artifact_root_uri = f"file://{root_dir.as_posix()}"
        yield PublishFixture(
            artifact_root_uri=artifact_root_uri,
            cycle=cycle,
            fhours=fhours,
            model_id=model_id,
            model_label=model_label,
            run_id=DEFAULT_RUN_ID,
            ctx=ExecutionContext(
                model_id=model_id,
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            ),
            ap=ArtifactPaths(artifact_root_uri),
            store=make_store(),
            grid_meta=grid_meta_fixture(),
        )
