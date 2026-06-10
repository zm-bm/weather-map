from __future__ import annotations

import gzip
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

from weather_etl.config.encoding import payload_suffix_for_dtype
from weather_etl.processing.artifact import process_artifact
from weather_etl.processing.grib import grid_meta_from_grib
from weather_etl.processing.proc import RunFn
from weather_etl.sources.icon.params import ICON_PARAM_SELECTOR_KEY
from weather_etl.sources.prepared_grib import PreparedGribSource
from weather_etl.state.artifacts.identity import ArtifactWorkItem
from weather_etl.state.artifacts.markers_schema import build_artifact_marker_payload
from weather_etl.state.artifacts.paths import ArtifactPaths
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.storage.base import UriStore
from weather_etl.storage.routing import make_store

from .artifact_specs import artifact_spec_for_dataset
from .artifacts import DEFAULT_CODE_REVISION, DEFAULT_IMAGE_IDENTITY, DEFAULT_PRODUCT_CONFIG_DIGEST, DEFAULT_RUN_ID
from .grids import small_grid_meta_fixture


@dataclass(frozen=True)
class GribProcessingMocks:
    find_band: Any
    extract_band: Any
    grid_meta: Any


def grib_band(
    *,
    index: int = 1,
    metadata: dict[str, Any] | None = None,
    nodata_value: object | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(index=index, metadata=metadata or {}, nodata_value=nodata_value)


def grib_bands(
    *metadata_items: dict[str, Any],
    index: int | None = None,
    start_index: int = 1,
    nodata_value: object | None = None,
) -> list[SimpleNamespace]:
    return [
        grib_band(index=index if index is not None else start_index + offset, metadata=metadata, nodata_value=nodata_value)
        for offset, metadata in enumerate(metadata_items)
    ]


@dataclass(frozen=True)
class ArtifactRunFixture:
    root_dir: Path
    out_dir: Path
    workdir: Path
    artifact_root_uri: str
    dataset_id: str
    cycle: str
    run_id: str
    frame_id: str
    source_uri: str
    store: UriStore

    def grib_path(self, name: str = "input.grib2") -> Path:
        path = self.root_dir / name
        path.write_bytes(b"grib")
        return path

    def item(self, artifact_id: str, *, source_uri: str | None = None) -> ArtifactWorkItem:
        return ArtifactWorkItem(
            dataset_id=self.dataset_id,
            cycle=self.cycle,
            run_id=self.run_id,
            frame_id=self.frame_id,
            artifact_id=artifact_id,
            source_uri=source_uri or self.source_uri,
            code_revision=DEFAULT_CODE_REVISION,
            image_identity=DEFAULT_IMAGE_IDENTITY,
            product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
        )

    def single_grib_source(self, *, grid_id: str = "gfs_0p25_global", path: Path | None = None) -> PreparedGribSource:
        return PreparedGribSource.grib(
            uri=self.source_uri,
            path=path or self.grib_path(),
            grid_id=grid_id,
        )

    def grib_collection_source(self, *, grib_paths: dict[str, Path], grid_id: str) -> PreparedGribSource:
        return PreparedGribSource.grib_collection(
            uri=self.source_uri,
            grib_paths=grib_paths,
            grid_id=grid_id,
            selector_key=ICON_PARAM_SELECTOR_KEY,
        )

    def run_artifact(
        self,
        *,
        artifact_id: str,
        artifact_config: dict,
        source: PreparedGribSource,
        run: RunFn,
    ) -> dict[str, Any]:
        artifact = artifact_spec_for_dataset(
            dataset_id=self.dataset_id,
            artifact_id=artifact_id,
            raw=artifact_config,
        )
        item = self.item(artifact_id)
        artifacts = ArtifactRepository.for_root(store=self.store, artifact_root_uri=self.artifact_root_uri)
        grid = grid_meta_from_grib(grib_path=source.reference_grib_path(), run=run)
        processed = process_artifact(
            artifact=artifact,
            source=source,
            grid=grid,
            frame_id=self.frame_id,
            workdir=self.workdir,
            run=run,
        )
        payload_uri = artifacts.write_payload(item=item, dtype=processed.dtype, payload=processed.payload)
        return build_artifact_marker_payload(
            artifact=artifact,
            payload_uri=payload_uri,
            payload=processed.payload,
            grid_id=processed.grid_id,
            grid=processed.grid,
        )

    @contextmanager
    def patch_grib_processing(
        self,
        *,
        band: SimpleNamespace | None = None,
        bands: list[SimpleNamespace] | tuple[SimpleNamespace, ...] | None = None,
        source: bytes | tuple[bytes, str] | None = None,
        sources: list[bytes | tuple[bytes, str]] | tuple[bytes | tuple[bytes, str], ...] | None = None,
        grid: dict[str, Any] | None = None,
    ) -> Iterator[GribProcessingMocks]:
        find_kwargs: dict[str, Any] = {}
        if band is not None:
            find_kwargs["return_value"] = band
        if bands is not None:
            find_kwargs["side_effect"] = list(bands)

        extract_kwargs: dict[str, Any] = {}
        if source is not None:
            extract_kwargs["return_value"] = _source_result(source)
        if sources is not None:
            extract_kwargs["side_effect"] = [_source_result(item) for item in sources]

        with (
            patch("weather_etl.processing.grib.find_grib_band", **find_kwargs) as find_band,
            patch("weather_etl.processing.grib.extract_float32_band_bytes", **extract_kwargs) as extract_band,
            patch(
                "tests.fixtures.artifact_runs.grid_meta_from_grib",
                return_value=grid or small_grid_meta_fixture(),
            ) as grid_meta,
        ):
            yield GribProcessingMocks(find_band=find_band, extract_band=extract_band, grid_meta=grid_meta)

    def payload_path(self, *, artifact_id: str, dtype: str) -> Path:
        return (
            self.out_dir
            / "runs"
            / self.dataset_id
            / self.cycle
            / self.run_id
            / "payloads"
            / self.frame_id
            / f"{artifact_id}.{payload_suffix_for_dtype(dtype)}.bin"
        )

    def payload_uri(self, *, artifact_id: str, dtype: str) -> str:
        return ArtifactPaths(self.artifact_root_uri).payload_uri(
            self.item(artifact_id),
            dtype=dtype,
        )

    def payload_bytes(self, *, artifact_id: str, dtype: str) -> bytes:
        return gzip.decompress(self.payload_path(artifact_id=artifact_id, dtype=dtype).read_bytes())


def _source_result(source: bytes | tuple[bytes, str]) -> tuple[bytes, str]:
    if isinstance(source, tuple):
        return source
    return source, "little"


@contextmanager
def artifact_run_fixture(
    *,
    prefix: str = "weather-map-artifact-",
    dataset_id: str = "gfs",
    cycle: str = "2026041200",
    run_id: str = DEFAULT_RUN_ID,
    frame_id: str = "003",
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
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            frame_id=frame_id,
            source_uri=source_uri,
            store=make_store(),
        )
