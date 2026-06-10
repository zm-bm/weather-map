from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _default_artifact_root_uri() -> str:
    docker_artifacts = Path("/artifacts")
    if docker_artifacts.exists():
        return docker_artifacts.as_uri()
    return (_repo_root() / "artifacts").as_uri()


@dataclass(frozen=True)
class Settings:
    artifact_root_uri: str


def load_settings() -> Settings:
    return Settings(
        artifact_root_uri=os.environ.get("ARTIFACT_ROOT_URI", _default_artifact_root_uri()),
    )
