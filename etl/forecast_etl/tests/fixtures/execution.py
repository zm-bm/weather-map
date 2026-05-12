from __future__ import annotations

import gzip
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from forecast_etl.artifacts.markers_schema import build_product_marker_payload
from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.encoding.product_payload import encode_product_payload
from forecast_etl.extract.grib import grid_meta_from_grib
from forecast_etl.extract.product_bands import extract_product_bands
from forecast_etl.proc import RunFn
from forecast_etl.source_adapters.base import PreparedSource
from forecast_etl.storage.base import UriStore
from forecast_etl.storage.routing import make_store

from .products import product_spec


@dataclass(frozen=True)
class ProductRunFixture:
    root_dir: Path
    out_dir: Path
    workdir: Path
    artifact_root_uri: str
    model_id: str
    cycle: str
    fhour: str
    source_uri: str
    store: UriStore

    def grib_path(self, name: str = "input.grib2") -> Path:
        path = self.root_dir / name
        path.write_bytes(b"grib")
        return path

    def item(self, product_id: str, *, source_uri: str | None = None) -> WorkItem:
        return WorkItem(
            model_id=self.model_id,
            cycle=self.cycle,
            fhour=self.fhour,
            product_id=product_id,
            source_uri=source_uri or self.source_uri,
        )

    def single_grib_source(self, *, grid_id: str = "gfs_0p25_global", path: Path | None = None) -> PreparedSource:
        return PreparedSource.grib(
            uri=self.source_uri,
            path=path or self.grib_path(),
            grid_id=grid_id,
        )

    def grib_collection_source(self, *, grib_paths: dict[str, Path], grid_id: str) -> PreparedSource:
        return PreparedSource.grib_collection(
            uri=self.source_uri,
            grib_paths=grib_paths,
            grid_id=grid_id,
        )

    def run_product(
        self,
        *,
        product_id: str,
        product_config: dict,
        source: PreparedSource,
        run: RunFn,
    ) -> dict[str, Any]:
        product = product_spec(product_id, product_config)
        item = self.item(product_id)
        artifacts = ArtifactRepository.for_root(store=self.store, artifact_root_uri=self.artifact_root_uri)
        grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=run)
        bands = extract_product_bands(
            product=product,
            grid=grid,
            source=source,
            workdir=self.workdir,
            run=run,
        )
        payload = encode_product_payload(product=product, grid=grid, bands=bands)
        payload_uri = artifacts.write_field_payload(item=item, dtype=product.encoding.dtype, payload=payload)
        return build_product_marker_payload(
            product=product,
            payload_uri=payload_uri,
            payload=payload,
            grid_id=source.grid_id,
            grid=grid,
        )

    def payload_path(self, *, product_id: str, dtype: str) -> Path:
        suffix = "i16" if dtype == "int16" else "i8"
        return self.out_dir / "fields" / self.model_id / self.cycle / self.fhour / f"{product_id}.field.{suffix}.bin"

    def payload_uri(self, *, product_id: str, dtype: str) -> str:
        return ArtifactPaths(self.artifact_root_uri).output_field_payload_uri(
            self.item(product_id),
            dtype=dtype,
        )

    def payload_bytes(self, *, product_id: str, dtype: str) -> bytes:
        return gzip.decompress(self.payload_path(product_id=product_id, dtype=dtype).read_bytes())


@contextmanager
def product_run_fixture(
    *,
    prefix: str = "weather-map-product-",
    model_id: str = "gfs",
    cycle: str = "2026041200",
    fhour: str = "003",
    source_uri: str = "file:///dev/null",
) -> Iterator[ProductRunFixture]:
    with tempfile.TemporaryDirectory(prefix=prefix) as td:
        root_dir = Path(td)
        workdir = root_dir / "work"
        workdir.mkdir(parents=True, exist_ok=True)
        out_dir = root_dir / "out"
        artifact_root_uri = f"file://{out_dir.as_posix()}"
        yield ProductRunFixture(
            root_dir=root_dir,
            out_dir=out_dir,
            workdir=workdir,
            artifact_root_uri=artifact_root_uri,
            model_id=model_id,
            cycle=cycle,
            fhour=fhour,
            source_uri=source_uri,
            store=make_store(),
        )
