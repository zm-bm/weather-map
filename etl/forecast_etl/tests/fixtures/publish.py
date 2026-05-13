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
from forecast_etl.config.resolved import ProductGroup
from forecast_etl.manifest.publish import PublishResult, run_publish
from forecast_etl.runtime import ExecutionContext
from forecast_etl.storage.base import UriStore
from forecast_etl.storage.routing import make_store

from .grids import grid_meta_fixture
from .markers import write_scalar_marker, write_vector_marker
from .products import minimal_product_config, product_specs


@dataclass(frozen=True)
class PublishFixture:
    artifact_root_uri: str
    cycle: str
    fhours: tuple[str, ...]
    model_id: str
    model_label: str
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

    def marker_uri(self, product_id: str, *, cycle: str | None = None, fhour: str | None = None) -> str:
        return self.ap.success_marker_uri_parts(
            model_id=self.model_id,
            cycle=cycle or self.cycle,
            fhour=fhour or self.fhours[0],
            product_id=product_id,
        )

    def write_scalar_marker(
        self,
        *,
        product_id: str = "tmp_surface",
        product_config: dict | None = None,
        cycle: str | None = None,
        fhour: str | None = None,
        values: Sequence[float] | None = None,
        base: float = 0.0,
    ) -> None:
        write_scalar_marker(
            store=self.store,
            ap=self.ap,
            cycle=cycle or self.cycle,
            fhour=fhour or self.fhours[0],
            variable=product_id,
            source_values=list(values) if values is not None else self.values(base),
            product_config=product_config or minimal_product_config(),
            grid_meta=self.grid_meta,
        )

    def write_scalar_markers(
        self,
        *,
        product_id: str = "tmp_surface",
        product_config: dict | None = None,
        cycle: str | None = None,
        base: float = 0.0,
    ) -> None:
        for fhour in self.fhours:
            self.write_scalar_marker(
                product_id=product_id,
                product_config=product_config,
                cycle=cycle,
                fhour=fhour,
                base=base,
            )

    def write_vector_marker(
        self,
        *,
        product_id: str = "wind10m_uv",
        cycle: str | None = None,
        fhour: str | None = None,
    ) -> None:
        write_vector_marker(
            store=self.store,
            ap=self.ap,
            cycle=cycle or self.cycle,
            fhour=fhour or self.fhours[0],
            variable=product_id,
            grid_meta=self.grid_meta,
        )

    def write_vector_markers(self, *, product_id: str = "wind10m_uv", cycle: str | None = None) -> None:
        for fhour in self.fhours:
            self.write_vector_marker(product_id=product_id, cycle=cycle, fhour=fhour)

    def publish(
        self,
        *,
        product_ids: Sequence[str],
        products_cfg: dict[str, dict],
        product_groups: Sequence[ProductGroup] | None = None,
        cycle: str | None = None,
    ) -> PublishResult:
        return run_publish(
            model_label=self.model_label,
            ctx=self.ctx,
            cycle=cycle or self.cycle,
            product_ids=tuple(product_ids),
            products=product_specs(products_cfg),
            product_groups=product_groups,
            artifacts=self.artifacts,
        )

    def cycle_manifest(self, *, cycle: str | None = None) -> dict[str, Any]:
        uri = self.ap.manifest_cycle_uri(model_id=self.model_id, cycle=cycle or self.cycle)
        return json.loads(self.store.read_bytes(uri=uri).decode("utf-8"))

    def latest_manifest(self) -> dict[str, Any]:
        return json.loads(self.store.read_bytes(uri=self.ap.manifest_latest_uri(model_id=self.model_id)).decode("utf-8"))

    def payload_bytes(self, *, product_id: str, fhour: str, dtype: str, cycle: str | None = None) -> bytes:
        payload_uri = self.ap.output_field_payload_uri(
            item=WorkItem(
                model_id=self.model_id,
                cycle=cycle or self.cycle,
                fhour=fhour,
                product_id=product_id,
                source_uri="file:///dev/null",
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
            ctx=ExecutionContext(
                model_id=model_id,
                artifact_root_uri=artifact_root_uri,
                forecast_hours=fhours,
            ),
            ap=ArtifactPaths(artifact_root_uri),
            store=make_store(),
            grid_meta=grid_meta_fixture(),
        )
