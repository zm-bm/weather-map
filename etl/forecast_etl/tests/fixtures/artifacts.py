from __future__ import annotations

import json
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from forecast_etl.artifacts.paths import SUCCESS_MARKER_SUFFIX, ArtifactPaths, WorkItem
from forecast_etl.artifacts.published_schema import published_marker_dict
from forecast_etl.artifacts.repository import ArtifactRepository
from forecast_etl.manifest.pointers import CURRENT_POINTER_SCHEMA, LATEST_POINTER_SCHEMA, manifest_pointer_dict
from forecast_etl.storage.base import UriStore
from forecast_etl.storage.local import LocalFSStore

DEFAULT_RUN_ID = "20260411T000000Z-00000000"
DEFAULT_CODE_REVISION = "test-revision"
DEFAULT_IMAGE_IDENTITY = "test-image"
DEFAULT_CONFIG_DIGEST = "sha256:" + "0" * 64


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
        model_id: str = "gfs",
        cycle: str,
        generated_at: datetime,
        latest: bool = True,
        revision: str = "abc123",
    ) -> str:
        manifest = manifest_payload(model_id=model_id, cycle=cycle, generated_at=generated_at, revision=revision)
        manifest_uri = self.repository.write_public_run_manifest(
            model_id=model_id,
            cycle=cycle,
            run_id=DEFAULT_RUN_ID,
            manifest=manifest,
        )
        pointer = manifest_pointer_dict(
            schema_name=CURRENT_POINTER_SCHEMA,
            model_id=model_id,
            cycle=cycle,
            run_id=DEFAULT_RUN_ID,
            revision=revision,
            generated_at=iso_utc(generated_at),
            manifest_path=self.paths.relative_key(manifest_uri),
        )
        self.repository.write_cycle_current_pointer(model_id=model_id, cycle=cycle, pointer=pointer)
        if latest:
            self.repository.write_latest_pointer(
                model_id=model_id,
                pointer={**pointer, "schema": LATEST_POINTER_SCHEMA},
            )
        return manifest_uri

    def write_success_marker(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        artifact_id: str,
        fhour: str,
        run_id: str = DEFAULT_RUN_ID,
        modified: datetime | None = None,
    ) -> str:
        marker_uri = self.repository.write_success_marker(
            item=WorkItem(
                model_id=model_id,
                cycle=cycle,
                run_id=run_id,
                artifact_id=artifact_id,
                fhour=fhour,
                source_uri="file:///dev/null",
                code_revision=DEFAULT_CODE_REVISION,
                image_identity=DEFAULT_IMAGE_IDENTITY,
                config_digest=DEFAULT_CONFIG_DIGEST,
            ),
            artifact=artifact_marker_payload(),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def write_invalid_success_marker(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        artifact_id: str,
        fhour: str,
        run_id: str = DEFAULT_RUN_ID,
        modified: datetime | None = None,
    ) -> str:
        marker_uri = self.paths.success_marker_uri_parts(
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
            artifact_id=artifact_id,
            fhour=fhour,
        )
        self.store.write_bytes(
            uri=marker_uri,
            data=(json.dumps(invalid_success_marker_payload(cycle=cycle, fhour=fhour), sort_keys=True) + "\n").encode(
                "utf-8"
            ),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def write_published_marker(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        generated_at: datetime,
        run_id: str = DEFAULT_RUN_ID,
        modified: datetime | None = None,
        revision: str = "abc123",
        manifest_uri: str | None = None,
    ) -> str:
        marker_uri = self.repository.write_published_marker(
            model_id=model_id,
            cycle=cycle,
            run_id=run_id,
            marker=published_marker_dict(
                cycle=cycle,
                model=model_id,
                generated_at=iso_utc(generated_at),
                revision=revision,
                manifest_uri=manifest_uri
                or self.paths.public_run_manifest_uri(model_id=model_id, cycle=cycle, run_id=run_id),
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
    model_id: str = "gfs",
) -> dict[str, Any]:
    return {
        "run": {
            "cycle": cycle,
            "runId": DEFAULT_RUN_ID,
            "payloadRoot": f"runs/{model_id}/{cycle}/{DEFAULT_RUN_ID}/fields",
            "generatedAt": iso_utc(generated_at),
            "revision": revision,
        }
    }


def success_marker_payload(
    *,
    cycle: str,
    run_id: str = DEFAULT_RUN_ID,
    fhour: str,
    artifact_id: str,
    payload_uri: str = "file:///payload.bin",
) -> dict[str, Any]:
    return {
        "cycle": cycle,
        "run_id": run_id,
        "model_id": "gfs",
        "fhour": fhour,
        "artifact_id": artifact_id,
        "code_revision": DEFAULT_CODE_REVISION,
        "image_identity": DEFAULT_IMAGE_IDENTITY,
        "config_digest": DEFAULT_CONFIG_DIGEST,
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
    fhour = parts[-1].removesuffix(SUCCESS_MARKER_SUFFIX)
    return success_marker_payload(cycle=cycle, run_id=run_id, fhour=fhour, artifact_id=artifact_id)


def invalid_success_marker_payload(*, cycle: str, fhour: str) -> dict[str, Any]:
    return {"cycle": cycle, "fhour": fhour, "artifact": {}}


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
