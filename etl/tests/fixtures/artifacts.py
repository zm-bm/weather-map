from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from weather_etl.core.timestamps import isoformat_utc
from weather_etl.state.artifacts.identity import ArtifactWorkItem
from weather_etl.state.artifacts.paths import SUCCESS_MARKER_SUFFIX, ArtifactPaths
from weather_etl.state.artifacts.publication_schema import run_publication_marker_dict
from weather_etl.state.artifacts.repository import ArtifactRepository
from weather_etl.state.manifest.constants import DATA_BINARY_CONTRACT, MANIFEST_SCHEMA, MANIFEST_SCHEMA_VERSION
from weather_etl.state.manifest.schema import parse_cycle_manifest
from weather_etl.storage.base import UriStore
from weather_etl.storage.local import LocalFSStore

DEFAULT_RUN_ID = "20260411T000000Z-00000000"
DEFAULT_CODE_REVISION = "test-revision"
DEFAULT_IMAGE_IDENTITY = "test-image"
DEFAULT_PRODUCT_CONFIG_DIGEST = "sha256:" + "0" * 64


@dataclass(frozen=True)
class ArtifactFixture:
    root_dir: Path
    paths: ArtifactPaths
    store: UriStore

    @property
    def repository(self) -> ArtifactRepository:
        return ArtifactRepository(store=self.store, paths=self.paths)

    def write_manifest(
        self,
        *,
        dataset_id: str = "gfs",
        cycle: str,
        generated_at: datetime,
        latest: bool = True,
        revision: str = "abc123",
    ) -> str:
        manifest = parse_cycle_manifest(
            manifest_payload(dataset_id=dataset_id, cycle=cycle, generated_at=generated_at, revision=revision)
        )
        manifest_uri = self.repository.write_public_run_manifest(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=DEFAULT_RUN_ID,
            manifest=manifest,
        )
        self.repository.write_cycle_current_manifest(
            dataset_id=dataset_id,
            cycle=cycle,
            manifest=manifest,
        )
        if latest:
            self.repository.write_latest_manifest(
                dataset_id=dataset_id,
                manifest=manifest,
            )
        return manifest_uri

    def write_success_marker(
        self,
        *,
        dataset_id: str = "gfs",
        cycle: str,
        artifact_id: str,
        frame_id: str,
        run_id: str = DEFAULT_RUN_ID,
        modified: datetime | None = None,
    ) -> str:
        marker_uri = self.repository.write_success_marker(
            item=ArtifactWorkItem(
                dataset_id=dataset_id,
                cycle=cycle,
                run_id=run_id,
                artifact_id=artifact_id,
                frame_id=frame_id,
                source_uri="file:///dev/null",
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
            ),
            artifact=artifact_marker_payload(),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def write_invalid_success_marker(
        self,
        *,
        dataset_id: str = "gfs",
        cycle: str,
        artifact_id: str,
        frame_id: str,
        run_id: str = DEFAULT_RUN_ID,
        modified: datetime | None = None,
    ) -> str:
        marker_uri = self.paths.success_marker_uri_parts(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            artifact_id=artifact_id,
            frame_id=frame_id,
        )
        self.store.write_bytes(
            uri=marker_uri,
            data=(json.dumps(invalid_success_marker_payload(cycle=cycle, frame_id=frame_id), sort_keys=True) + "\n").encode(
                "utf-8"
            ),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def write_publication(
        self,
        *,
        dataset_id: str = "gfs",
        cycle: str,
        generated_at: datetime,
        run_id: str = DEFAULT_RUN_ID,
        modified: datetime | None = None,
        revision: str = "abc123",
        manifest_path: str | None = None,
    ) -> str:
        resolved_manifest_path = manifest_path or self.paths.public_run_manifest_key(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
        )
        marker_uri = self.repository.write_publication(
            dataset_id=dataset_id,
            cycle=cycle,
            run_id=run_id,
            marker=run_publication_marker_dict(
                cycle=cycle,
                dataset_id=dataset_id,
                run_id=run_id,
                generated_at=iso_utc(generated_at),
                revision=revision,
                manifest_path=resolved_manifest_path,
            ),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def touch(self, uri: str, modified: datetime | None) -> None:
        if modified is None:
            return
        path = self.root_dir / self.paths.relative_key(uri)
        os.utime(path, (modified.timestamp(), modified.timestamp()))


def artifact_fixture(root: Path) -> ArtifactFixture:
    return ArtifactFixture(root_dir=root, paths=ArtifactPaths(root.as_uri()), store=LocalFSStore())


@contextmanager
def temp_artifact_fixture() -> Iterator[ArtifactFixture]:
    with tempfile.TemporaryDirectory(prefix="weather-map-artifacts-") as td:
        yield artifact_fixture(Path(td))


def manifest_payload(
    *,
    cycle: str,
    generated_at: datetime,
    revision: str = "abc123",
    dataset_id: str = "gfs",
) -> dict[str, Any]:
    return {
        "schema": MANIFEST_SCHEMA,
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "payload_contract": DATA_BINARY_CONTRACT,
        "dataset": {"id": dataset_id, "label": dataset_id.upper()},
        "run": {
            "cycle": cycle,
            "run_id": DEFAULT_RUN_ID,
            "payload_root": f"runs/{dataset_id}/{cycle}/{DEFAULT_RUN_ID}/payloads",
            "generated_at": iso_utc(generated_at),
            "revision": revision,
        },
        "frames": [{"id": "000", "lead_hours": 0, "valid_at": iso_utc(generated_at)}],
        "artifacts": {
            "tmp_surface": {
                "id": "tmp_surface",
                "kind": "scalar",
                "units": "C",
                "parameter": "tmp",
                "level": "surface",
                "components": ["value"],
                "grid": {
                    "id": "gfs_0p25_global",
                    "crs": "EPSG:4326",
                    "nx": 1,
                    "ny": 1,
                    "lon0": 0.0,
                    "lat0": 0.0,
                    "dx": 1.0,
                    "dy": 1.0,
                    "origin": "cell_center",
                    "layout": "row_major",
                    "x_wrap": "repeat",
                    "y_mode": "clamp",
                },
                "encoding": {
                    "id": "tmp_surface_i16_v1",
                    "format": "linear-i16-v1",
                    "dtype": "int16",
                },
                "payload_file": "tmp_surface.i16.bin",
                "frames": {
                    "000": {
                        "path": f"runs/{dataset_id}/{cycle}/{DEFAULT_RUN_ID}/payloads/000/tmp_surface.i16.bin",
                        "byte_length": 2,
                        "sha256": "a" * 64,
                    },
                },
            }
        },
    }


def success_marker_payload(
    *,
    cycle: str,
    run_id: str = DEFAULT_RUN_ID,
    frame_id: str,
    artifact_id: str,
    payload_uri: str = "file:///payload.bin",
) -> dict[str, Any]:
    return {
        "schema": "weather-map.etl-artifact-success",
        "schema_version": 2,
        "cycle": cycle,
        "run_id": run_id,
        "dataset_id": "gfs",
        "frame_id": frame_id,
        "artifact_id": artifact_id,
        "generated_at": "2026-04-11T00:00:00Z",
        "code_revision": DEFAULT_CODE_REVISION,
        "image_identity": DEFAULT_IMAGE_IDENTITY,
        "product_config_digest": DEFAULT_PRODUCT_CONFIG_DIGEST,
        "artifact": artifact_marker_payload(payload_uri=payload_uri),
    }


def artifact_marker_payload(*, payload_uri: str = "file:///payload.bin", **overrides: Any) -> dict[str, Any]:
    payload = {
        "payload_uri": payload_uri,
        "byte_length": 1,
        "sha256": "a" * 64,
        "format": "linear-i16-v1",
        "encoding_id": "encoding",
        "units": "C",
        "parameter": "parameter",
        "level": "level",
        "grid_id": "grid",
        "grid": {
            "crs": "EPSG:4326",
            "nx": 1,
            "ny": 1,
            "lon0": 0,
            "lat0": 0,
            "dx": 1,
            "dy": 1,
            "origin": "cell_center",
            "layout": "row_major",
            "x_wrap": "repeat",
            "y_mode": "clamp",
        },
        "components": ["value"],
    }
    payload.update(overrides)
    return payload


def success_marker_payload_from_uri(uri: str) -> dict[str, Any]:
    parts = uri.rstrip("/").split("/")
    cycle = parts[-5]
    run_id = parts[-4]
    artifact_id = parts[-2]
    frame_id = parts[-1].removesuffix(SUCCESS_MARKER_SUFFIX)
    return success_marker_payload(cycle=cycle, run_id=run_id, frame_id=frame_id, artifact_id=artifact_id)


def invalid_success_marker_payload(*, cycle: str, frame_id: str) -> dict[str, Any]:
    return {"cycle": cycle, "frame_id": frame_id, "artifact": {}}


def iso_utc(value: datetime) -> str:
    return isoformat_utc(value)
