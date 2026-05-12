from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from forecast_etl.artifacts.json import write_json
from forecast_etl.artifacts.names import SUCCESS_MARKER_SUFFIX
from forecast_etl.artifacts.paths import ArtifactPaths
from forecast_etl.artifacts.published import published_marker_dict
from forecast_etl.stores.base import UriStore
from forecast_etl.stores.local_fs import LocalFSStore


@dataclass(frozen=True)
class ArtifactFixture:
    root_dir: Path
    paths: ArtifactPaths
    store: UriStore

    def write_manifest(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        generated_at: datetime,
        latest: bool = True,
        revision: str = "abc123",
    ) -> str:
        manifest = manifest_payload(cycle=cycle, generated_at=generated_at, revision=revision)
        manifest_uri = self.paths.manifest_cycle_uri(model_id=model_id, cycle=cycle)
        write_json(store=self.store, uri=manifest_uri, obj=manifest)
        if latest:
            write_json(store=self.store, uri=self.paths.manifest_latest_uri(model_id=model_id), obj=manifest)
        return manifest_uri

    def write_success_marker(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        product_id: str,
        fhour: str,
        modified: datetime | None = None,
    ) -> str:
        marker_uri = self.paths.success_marker_uri_parts(
            model_id=model_id,
            cycle=cycle,
            product_id=product_id,
            fhour=fhour,
        )
        write_json(
            store=self.store,
            uri=marker_uri,
            obj=success_marker_payload(cycle=cycle, fhour=fhour, product_id=product_id),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def write_invalid_success_marker(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        product_id: str,
        fhour: str,
        modified: datetime | None = None,
    ) -> str:
        marker_uri = self.paths.success_marker_uri_parts(
            model_id=model_id,
            cycle=cycle,
            product_id=product_id,
            fhour=fhour,
        )
        write_json(store=self.store, uri=marker_uri, obj=invalid_success_marker_payload(cycle=cycle, fhour=fhour))
        self.touch(marker_uri, modified)
        return marker_uri

    def write_published_marker(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        generated_at: datetime,
        modified: datetime | None = None,
        revision: str = "abc123",
        manifest_uri: str | None = None,
    ) -> str:
        marker_uri = self.paths.published_marker_uri(model_id=model_id, cycle=cycle)
        write_json(
            store=self.store,
            uri=marker_uri,
            obj=published_marker_dict(
                cycle=cycle,
                model=model_id,
                generated_at=iso_utc(generated_at),
                revision=revision,
                manifest_uri=manifest_uri or self.paths.manifest_cycle_uri(model_id=model_id, cycle=cycle),
            ),
        )
        self.touch(marker_uri, modified)
        return marker_uri

    def write_status_markers(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        products: Sequence[str],
        fhours: Sequence[str],
        count: int,
        modified: datetime | None = None,
        published: bool = False,
    ) -> None:
        written = 0
        for product_id in products:
            for fhour in fhours:
                if written >= count:
                    break
                self.write_success_marker(
                    model_id=model_id,
                    cycle=cycle,
                    product_id=product_id,
                    fhour=fhour,
                    modified=modified,
                )
                written += 1
            if written >= count:
                break
        if published:
            self.write_published_marker(model_id=model_id, cycle=cycle, generated_at=modified or now_utc(), modified=modified)

    def write_complete_status(
        self,
        *,
        model_id: str = "gfs",
        cycle: str,
        products: Sequence[str],
        fhours: Sequence[str],
        modified: datetime | None = None,
    ) -> None:
        self.write_status_markers(
            model_id=model_id,
            cycle=cycle,
            products=products,
            fhours=fhours,
            count=len(products) * len(fhours),
            modified=modified,
            published=True,
        )

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


def manifest_payload(*, cycle: str, generated_at: datetime, revision: str = "abc123") -> dict[str, Any]:
    return {
        "run": {
            "cycle": cycle,
            "generatedAt": iso_utc(generated_at),
            "revision": revision,
        }
    }


def success_marker_payload(
    *,
    cycle: str,
    fhour: str,
    product_id: str,
    payload_uri: str = "file:///payload.bin",
) -> dict[str, Any]:
    return {
        "cycle": cycle,
        "fhour": fhour,
        "product_id": product_id,
        "product": {
            "payload_uri": payload_uri,
            "byte_length": 1,
            "sha256": "a" * 64,
            "format": "linear-i16-v1",
            "encoding_id": "encoding",
            "units": "C",
            "parameter": "parameter",
            "level": "level",
            "valid_min": 0,
            "valid_max": 1,
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
            "style": {
                "layer_id": "scalar",
                "palette_id": "palette",
            },
        },
    }


def success_marker_payload_from_uri(uri: str) -> dict[str, Any]:
    parts = uri.rstrip("/").split("/")
    cycle = parts[-3]
    product_id = parts[-2]
    fhour = parts[-1].removesuffix(SUCCESS_MARKER_SUFFIX)
    return success_marker_payload(cycle=cycle, fhour=fhour, product_id=product_id)


def invalid_success_marker_payload(*, cycle: str, fhour: str) -> dict[str, Any]:
    return {"cycle": cycle, "fhour": fhour, "product": {}}


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)
