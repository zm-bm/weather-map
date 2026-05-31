"""Scheduled publisher for completed forecast ETL cycles."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from ..artifacts.repository import ArtifactRepository
from ..config.load import load_pipeline_config
from ..config.resolved import PipelineConfig
from ..cycles import latest_synoptic_cycles, parse_cycle
from ..manifest.publish import run_publish
from ..runtime import execution_context_for_model
from ..storage.routing import make_store
from ..uris import default_artifact_root_uri, default_pipeline_config_uri

DEFAULT_PIPELINE_CONFIG_URI = default_pipeline_config_uri()
DEFAULT_ARTIFACT_ROOT_URI = default_artifact_root_uri()
DEFAULT_PUBLISH_MODELS = ("gfs", "icon")
DEFAULT_PUBLISH_CYCLE_COUNT = 8

_CONFIG_CACHE_BY_URI: dict[str, PipelineConfig] = {}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise SystemExit(f"{name} must be an integer, got: {raw!r}") from exc
    return max(0, value)


def _pipeline_config(pipeline_config_uri: str) -> PipelineConfig:
    cached = _CONFIG_CACHE_BY_URI.get(pipeline_config_uri)
    if cached is not None:
        return cached

    cfg = load_pipeline_config(pipeline_config_uri)
    _CONFIG_CACHE_BY_URI[pipeline_config_uri] = cfg
    print(f"Loaded publisher pipeline config from: {pipeline_config_uri}", flush=True)
    return cfg


def _event_now(event: dict[str, Any]) -> datetime:
    raw = event.get("time")
    if isinstance(raw, str) and raw.strip():
        text = raw.strip().replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    return datetime.now(timezone.utc)


def _string_tuple(value: Any, *, field_name: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        parts = value.replace(",", " ").split()
    elif isinstance(value, (list, tuple)):
        parts = [str(part) for part in value]
    else:
        raise SystemExit(f"{field_name} must be a string or array of strings")

    resolved = tuple(part.strip() for part in parts if part.strip())
    if not resolved:
        raise SystemExit(f"{field_name} did not contain any values")
    return resolved


def _publish_models(event: dict[str, Any]) -> tuple[str, ...]:
    if "models" in event:
        return _string_tuple(event.get("models"), field_name="models")
    return _string_tuple(os.environ.get("PUBLISH_MODELS", ",".join(DEFAULT_PUBLISH_MODELS)), field_name="PUBLISH_MODELS")


def _publish_cycles(event: dict[str, Any], *, now: datetime) -> tuple[str, ...]:
    if "cycles" in event:
        cycles = _string_tuple(event.get("cycles"), field_name="cycles")
    else:
        cycles = latest_synoptic_cycles(now=now, count=_int_env("PUBLISH_CYCLE_COUNT", DEFAULT_PUBLISH_CYCLE_COUNT))
    for cycle in cycles:
        parse_cycle(cycle)
    return cycles


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Publish ready cycle manifests for recent or explicitly supplied cycles."""

    del context
    event = event if isinstance(event, dict) else {}
    pipeline_config_uri = os.environ.get("PIPELINE_CONFIG_URI", DEFAULT_PIPELINE_CONFIG_URI).strip()
    artifact_root_uri = os.environ.get("ARTIFACT_ROOT_URI", DEFAULT_ARTIFACT_ROOT_URI).strip()

    cfg = _pipeline_config(pipeline_config_uri)
    store = make_store()
    artifact_repo = ArtifactRepository.for_root(store=store, artifact_root_uri=artifact_root_uri)
    cycles = _publish_cycles(event, now=_event_now(event))
    models = _publish_models(event)

    attempted = 0
    ready = 0
    published = 0
    already_published = 0
    latest_promoted = 0
    not_ready = 0
    failed = 0
    failures: list[dict[str, str]] = []

    for model_id in models:
        try:
            model = cfg.model(model_id)
            ctx = execution_context_for_model(model, artifact_root_uri)
        except (Exception, SystemExit) as exc:
            failed += len(cycles)
            for cycle in cycles:
                failures.append({"model": model_id, "cycle": cycle, "error": str(exc)})
            print(f"Publisher failed to load model={model_id}: {exc}", flush=True)
            continue

        for cycle in cycles:
            attempted += 1
            try:
                result = run_publish(
                    ctx=ctx,
                    cycle=cycle,
                    model_label=model.label,
                    artifact_ids=model.workload.artifacts,
                    artifact_specs=model.artifacts,
                    artifact_repo=artifact_repo,
                    pipeline_config=cfg,
                )
            except (Exception, SystemExit) as exc:
                failed += 1
                failures.append({"model": model_id, "cycle": cycle, "error": str(exc)})
                print(f"Publisher failed model={model_id} cycle={cycle}: {exc}", flush=True)
                continue

            if not result.ready:
                not_ready += 1
                print(
                    f"Publisher not ready model={model_id} cycle={cycle} "
                    f"missing={len(result.missing_markers)}",
                    flush=True,
                )
                continue

            ready += 1
            if result.already_published:
                already_published += 1
            else:
                published += 1
            if result.latest_promoted:
                latest_promoted += 1

    return {
        "ok": failed == 0,
        "models": len(models),
        "cycles": len(cycles),
        "attempted": attempted,
        "ready": ready,
        "published": published,
        "alreadyPublished": already_published,
        "latestPromoted": latest_promoted,
        "notReady": not_ready,
        "failed": failed,
        "failures": failures[:10],
    }
