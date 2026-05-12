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


def _default_pipeline_config_uri() -> str:
    docker_config = Path("/config/forecast.etl_config.json")
    if docker_config.exists():
        return docker_config.as_uri()
    return (_repo_root() / "infra" / "config" / "forecast.etl_config.json").as_uri()


@dataclass(frozen=True)
class Settings:
    artifact_root_uri: str
    pipeline_config_uri: str
    stale_fallback_hours: float
    recent_progress_hours: float
    publish_grace_cushion_hours: float
    publish_grace_min_hours: float
    publish_grace_max_hours: float
    history_cycle_count: int
    status_cycle_count: int


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def load_settings() -> Settings:
    return Settings(
        artifact_root_uri=os.environ.get("ARTIFACT_ROOT_URI", _default_artifact_root_uri()),
        pipeline_config_uri=os.environ.get("PIPELINE_CONFIG_URI", _default_pipeline_config_uri()),
        stale_fallback_hours=_float_env("HEALTH_STALE_FALLBACK_HOURS", 9.0),
        recent_progress_hours=_float_env("HEALTH_RECENT_PROGRESS_HOURS", 2.0),
        publish_grace_cushion_hours=_float_env("HEALTH_PUBLISH_GRACE_CUSHION_HOURS", 1.0),
        publish_grace_min_hours=_float_env("HEALTH_PUBLISH_GRACE_MIN_HOURS", 3.0),
        publish_grace_max_hours=_float_env("HEALTH_PUBLISH_GRACE_MAX_HOURS", 12.0),
        history_cycle_count=max(1, _int_env("HEALTH_HISTORY_CYCLE_COUNT", 4)),
        status_cycle_count=max(1, _int_env("HEALTH_STATUS_CYCLE_COUNT", 4)),
    )
