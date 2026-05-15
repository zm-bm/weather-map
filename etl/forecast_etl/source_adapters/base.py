"""Prepared source objects handed from source adapters to artifact execution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

DEFAULT_GRIB_COLLECTION_SELECTOR_KEY = "ICON_PARAM"


class PreparedSource:
    """Source object consumed by artifact extraction after acquisition."""

    uri: str
    grid_id: str

    @staticmethod
    def grib(*, uri: str, path: Path, grid_id: str) -> "PreparedSource":
        """Create a prepared source backed by one GRIB file."""

        return SingleGribPreparedSource(uri=uri, path=path, grid_id=grid_id)

    @staticmethod
    def grib_collection(
        *,
        uri: str,
        grib_paths: Mapping[str, Path],
        grid_id: str,
        selector_key: str = DEFAULT_GRIB_COLLECTION_SELECTOR_KEY,
    ) -> "PreparedSource":
        """Create a prepared source backed by selector-keyed GRIB files."""

        return GribCollectionPreparedSource(
            uri=uri,
            grib_paths=dict(grib_paths),
            grid_id=grid_id,
            selector_key=selector_key,
        )

    def reference_grib_path(self) -> Path:
        """Return a representative GRIB path for grid metadata reads."""

        raise NotImplementedError

    def component_grib_path(
        self,
        *,
        artifact_id: str,
        component_id: str,
        grib_match: Mapping[str, str],
    ) -> Path:
        """Return the GRIB path that should supply one artifact component."""

        raise NotImplementedError


@dataclass(frozen=True)
class SingleGribPreparedSource(PreparedSource):
    """Prepared source where every component reads from the same GRIB file."""

    uri: str
    path: Path
    grid_id: str

    def reference_grib_path(self) -> Path:
        return self.path

    def component_grib_path(
        self,
        *,
        artifact_id: str,
        component_id: str,
        grib_match: Mapping[str, str],
    ) -> Path:
        del artifact_id, component_id, grib_match
        return self.path


@dataclass(frozen=True)
class GribCollectionPreparedSource(PreparedSource):
    """Prepared source that selects component GRIB files by metadata value."""

    uri: str
    grib_paths: dict[str, Path]
    grid_id: str
    selector_key: str = DEFAULT_GRIB_COLLECTION_SELECTOR_KEY

    def __post_init__(self) -> None:
        selector_key = self.selector_key.strip()
        if not selector_key:
            raise SystemExit("Prepared GRIB collection selector_key must be non-empty")

        normalized_paths: dict[str, Path] = {}
        for key, path in self.grib_paths.items():
            normalized_key = str(key).strip().lower()
            if not normalized_key:
                raise SystemExit("Prepared GRIB collection contains an empty selector value")
            if normalized_key in normalized_paths:
                raise SystemExit(f"Prepared GRIB collection contains duplicate selector value: {key!r}")
            normalized_paths[normalized_key] = path

        if not normalized_paths:
            raise SystemExit("Prepared GRIB collection source requires at least one GRIB path")

        object.__setattr__(self, "selector_key", selector_key)
        object.__setattr__(self, "grib_paths", normalized_paths)

    def reference_grib_path(self) -> Path:
        return next(iter(self.grib_paths.values()))

    def component_grib_path(
        self,
        *,
        artifact_id: str,
        component_id: str,
        grib_match: Mapping[str, str],
    ) -> Path:
        raw_selector = grib_match.get(self.selector_key)
        selector_value = raw_selector.strip() if isinstance(raw_selector, str) else ""
        if not selector_value:
            raise SystemExit(
                f"Artifact {artifact_id}.{component_id} requires {self.selector_key} "
                "for GRIB collection source"
            )

        selector = selector_value.lower()
        grib_path = self.grib_paths.get(selector)
        if grib_path is None:
            raise SystemExit(
                f"Prepared GRIB collection missing {self.selector_key} {selector_value!r} "
                f"for artifact {artifact_id}.{component_id}"
            )
        return grib_path
