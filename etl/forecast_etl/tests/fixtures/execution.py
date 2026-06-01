from __future__ import annotations

import gzip
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from forecast_etl.artifacts.markers_schema import build_artifact_marker_payload
from forecast_etl.artifacts.paths import ArtifactPaths, WorkItem
from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.encoding.artifact_payload import encode_artifact_payload
from forecast_etl.extract.artifact_bands import extract_artifact_bands
from forecast_etl.extract.grib import grid_meta_from_grib
from forecast_etl.extract.grid_transforms import apply_artifact_grid_transform
from forecast_etl.proc import RunFn
from forecast_etl.source_adapters.base import PreparedSource
from forecast_etl.storage.base import UriStore
from forecast_etl.storage.routing import make_store

from .artifact_configs import artifact_spec
from .artifacts import DEFAULT_CODE_REVISION, DEFAULT_CONFIG_DIGEST, DEFAULT_IMAGE_IDENTITY, DEFAULT_RUN_ID


@dataclass(frozen=True)
class ArtifactRunFixture:
    root_dir: Path
    out_dir: Path
    workdir: Path
    artifact_root_uri: str
    model_id: str
    cycle: str
    run_id: str
    fhour: str
    source_uri: str
    store: UriStore

    def grib_path(self, name: str = "input.grib2") -> Path:
        path = self.root_dir / name
        path.write_bytes(b"grib")
        return path

    def item(self, artifact_id: str, *, source_uri: str | None = None) -> WorkItem:
        return WorkItem(
            model_id=self.model_id,
            cycle=self.cycle,
            run_id=self.run_id,
            fhour=self.fhour,
            artifact_id=artifact_id,
            source_uri=source_uri or self.source_uri,
            code_revision=DEFAULT_CODE_REVISION,
            image_identity=DEFAULT_IMAGE_IDENTITY,
            config_digest=DEFAULT_CONFIG_DIGEST,
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

    def run_artifact(
        self,
        *,
        artifact_id: str,
        artifact_config: dict,
        source: PreparedSource,
        run: RunFn,
    ) -> dict[str, Any]:
        artifact = artifact_spec(artifact_id, artifact_config)
        item = self.item(artifact_id)
        artifacts = ArtifactRepository.for_root(store=self.store, artifact_root_uri=self.artifact_root_uri)
        grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=run)
        bands = extract_artifact_bands(
            artifact=artifact,
            grid=grid,
            source=source,
            workdir=self.workdir,
            run=run,
            fhour=self.fhour,
        )
        transformed = apply_artifact_grid_transform(
            artifact=artifact,
            grid_id=source.grid_id,
            grid=grid,
            bands=bands,
        )
        payload = encode_artifact_payload(artifact=artifact, grid=transformed.grid, bands=transformed.bands)
        payload_uri = artifacts.write_field_payload(item=item, dtype=artifact.encoding.dtype, payload=payload)
        return build_artifact_marker_payload(
            artifact=artifact,
            payload_uri=payload_uri,
            payload=payload,
            grid_id=transformed.grid_id,
            grid=transformed.grid,
        )

    def payload_path(self, *, artifact_id: str, dtype: str) -> Path:
        suffix = "i16" if dtype == "int16" else "i8"
        return (
            self.out_dir
            / "runs"
            / self.model_id
            / self.cycle
            / self.run_id
            / "fields"
            / self.fhour
            / f"{artifact_id}.field.{suffix}.bin"
        )

    def payload_uri(self, *, artifact_id: str, dtype: str) -> str:
        return ArtifactPaths(self.artifact_root_uri).output_field_payload_uri(
            self.item(artifact_id),
            dtype=dtype,
        )

    def payload_bytes(self, *, artifact_id: str, dtype: str) -> bytes:
        return gzip.decompress(self.payload_path(artifact_id=artifact_id, dtype=dtype).read_bytes())


@contextmanager
def artifact_run_fixture(
    *,
    prefix: str = "weather-map-artifact-",
    model_id: str = "gfs",
    cycle: str = "2026041200",
    run_id: str = DEFAULT_RUN_ID,
    fhour: str = "003",
    source_uri: str = "file:///dev/null",
) -> Iterator[ArtifactRunFixture]:
    with tempfile.TemporaryDirectory(prefix=prefix) as td:
        root_dir = Path(td)
        workdir = root_dir / "work"
        workdir.mkdir(parents=True, exist_ok=True)
        out_dir = root_dir / "out"
        artifact_root_uri = f"file://{out_dir.as_posix()}"
        yield ArtifactRunFixture(
            root_dir=root_dir,
            out_dir=out_dir,
            workdir=workdir,
            artifact_root_uri=artifact_root_uri,
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
            fhour=fhour,
            source_uri=source_uri,
            store=make_store(),
        )
