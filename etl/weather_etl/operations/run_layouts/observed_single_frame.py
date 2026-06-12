"""Run layout for immutable observed single-frame runs."""

from __future__ import annotations

import copy
import hashlib
from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from ...config.pipeline import LoadedPipelineConfig, parse_pipeline_config
from ...config.product import LoadedProductConfig, build_loaded_product_config, product_config_digest
from ...environment import EtlEnvironment
from ...sources.registry import resolve_source_frame_ids, source_frame_datetime
from ...state.runs.metadata import RunSnapshot, run_metadata_from_env
from ...state.runs.snapshots import LoadedRunSnapshot
from ...storage.base import UriStore
from .base import RunTarget


def local_run_targets(
    *,
    product_config: LoadedProductConfig,
    dataset_id: str,
    run_id: str | None,
    selected_frames: Iterable[str] | None,
    store: UriStore | None,
) -> tuple[RunTarget, ...]:
    """Build one local run target per observed source frame."""

    if run_id is not None:
        raise SystemExit("--run-id is not supported for observed single-frame local runs; run ids are deterministic by frame")

    dataset = product_config.dataset(dataset_id)
    frame_ids = resolve_source_frame_ids(dataset=dataset, selected_frames=selected_frames, store=store)
    frame_times = tuple(
        (
            frame_id,
            observed_frame_datetime(product_config=product_config, dataset_id=dataset_id, frame_id=frame_id),
        )
        for frame_id in frame_ids
    )
    return tuple(
        _run_target_for_frame_timestamp(dataset_id=dataset_id, timestamp=timestamp)
        for _frame_id, timestamp in sorted(frame_times, key=lambda item: (item[1], item[0]))
    )


def ensure_run_snapshot(
    *,
    env: EtlEnvironment,
    product_config: LoadedProductConfig,
    dataset_id: str,
    cycle: str,
    run_id: str,
    selected_frames: Iterable[str] | None,
) -> LoadedRunSnapshot:
    """Create or verify the immutable one-frame observed product config snapshot."""

    frame_id = _single_frame(selected_frames)
    target = run_target_for_observed_frame(product_config=product_config, dataset_id=dataset_id, frame_id=frame_id)
    if cycle != target.cycle:
        raise SystemExit(f"Observed frame {frame_id} must use cycle {target.cycle}, got: {cycle}")
    if run_id != target.run_id:
        raise SystemExit(f"Observed frame {frame_id} must use deterministic run_id {target.run_id}, got: {run_id}")

    effective_product_config = build_pinned_product_config_for_frame(
        product_config=product_config,
        dataset_id=dataset_id,
        frame_id=_single_frame(target.snapshot_frames),
    )
    digest = product_config_digest(effective_product_config)
    snapshot = RunSnapshot(
        metadata=run_metadata_from_env(product_config_digest=digest),
        pipeline=effective_product_config.raw_pipeline_config,
        catalog=effective_product_config.catalog,
    )
    env.artifact_repo.ensure_run_snapshot(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)


def build_pinned_product_config_for_frame(
    *,
    product_config: LoadedProductConfig,
    dataset_id: str,
    frame_id: str,
) -> LoadedProductConfig:
    """Return a product config whose dataset workload is pinned to one observed frame."""

    target = run_target_for_observed_frame(product_config=product_config, dataset_id=dataset_id, frame_id=frame_id)
    resolved_frame_id = _single_frame(target.snapshot_frames)
    raw = _pipeline_with_workload_frame(
        product_config.raw_pipeline_config,
        dataset_id=dataset_id,
        frame_id=resolved_frame_id,
    )
    loaded_pipeline = LoadedPipelineConfig(raw=raw, config=parse_pipeline_config(raw))
    return build_loaded_product_config(
        loaded_pipeline_config=loaded_pipeline,
        catalog=product_config.catalog,
    )


def observed_frame_datetime(*, product_config: LoadedProductConfig, dataset_id: str, frame_id: str):
    """Return the UTC valid time for an observed frame."""

    dataset = product_config.dataset(dataset_id)
    return source_frame_datetime(dataset=dataset, frame_id=frame_id)


def run_target_for_observed_frame(*, product_config: LoadedProductConfig, dataset_id: str, frame_id: str) -> RunTarget:
    """Return the immutable run target for one observed timestamp frame."""

    timestamp = observed_frame_datetime(product_config=product_config, dataset_id=dataset_id, frame_id=frame_id)
    return _run_target_for_frame_timestamp(dataset_id=dataset_id, timestamp=timestamp)


def _run_target_for_frame_timestamp(*, dataset_id: str, timestamp: datetime) -> RunTarget:
    resolved_frame_id = timestamp.strftime("%Y%m%d%H%M%S")
    cycle = timestamp.strftime("%Y%m%d%H")
    created = timestamp.strftime("%Y%m%dT%H%M%SZ")
    suffix = hashlib.sha1(f"{dataset_id}:{resolved_frame_id}".encode("utf-8")).hexdigest()[:8]
    return RunTarget(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=f"{created}-{suffix}",
        snapshot_frames=(resolved_frame_id,),
        plan_frames=(resolved_frame_id,),
        rolling_anchor=timestamp,
    )


def observed_job_name_for_target(target: RunTarget) -> str:
    """Return the deterministic Batch job name for one observed run target."""

    frame_id = _single_frame(target.plan_frames)
    suffix = hashlib.sha1(f"{target.cycle}:{target.run_id}:{frame_id}".encode("utf-8")).hexdigest()[:8]
    return f"{target.dataset_id}-{target.cycle}-{target.run_id}-{frame_id}-{suffix}"[:128]


def rolling_scan_anchor(*, product_config: LoadedProductConfig, dataset_id: str):
    """Return the newest observed valid time in the dataset workload."""

    dataset = product_config.dataset(dataset_id)
    return max((source_frame_datetime(dataset=dataset, frame_id=frame_id) for frame_id in dataset.workload.frames), default=None)


def _pipeline_with_workload_frame(
    pipeline: Mapping[str, Any],
    *,
    dataset_id: str,
    frame_id: str,
) -> dict[str, Any]:
    raw = copy.deepcopy(dict(pipeline))
    try:
        dataset = raw["datasets"][dataset_id]
    except (KeyError, TypeError) as exc:
        raise SystemExit(f"Pipeline config missing dataset {dataset_id!r}") from exc
    workload = dataset.setdefault("workload", {})
    workload.pop("frame_start", None)
    workload.pop("frame_end", None)
    workload["frames"] = [frame_id]
    return raw


def _single_frame(selected_frames: Iterable[str] | None) -> str:
    frames = tuple(str(frame_id) for frame_id in selected_frames or ())
    if len(frames) != 1:
        raise SystemExit("Observed single-frame init-run requires exactly one timestamp frame via --frames")
    return frames[0]
