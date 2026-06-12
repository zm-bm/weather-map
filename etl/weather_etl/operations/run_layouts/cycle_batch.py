"""Run layout for immutable synoptic cycle batches."""

from __future__ import annotations

from collections.abc import Iterable

from ...config.product import LoadedProductConfig, product_config_digest
from ...core.cycles import parse_cycle
from ...environment import EtlEnvironment
from ...state.runs.metadata import RunSnapshot, run_metadata_from_env
from ...state.runs.snapshots import LoadedRunSnapshot
from .base import RunTarget


def local_run_target(
    *,
    dataset_id: str,
    cycle: str | None,
    run_id: str,
    selected_frames: Iterable[str] | None,
) -> RunTarget:
    """Build the one local run target for a cycle-batch dataset."""

    resolved_cycle = _required_cycle(cycle)
    return RunTarget(
        dataset_id=dataset_id,
        cycle=resolved_cycle,
        run_id=run_id,
        snapshot_frames=None,
        plan_frames=tuple(selected_frames) if selected_frames is not None else None,
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
    """Create or verify the immutable full-cycle product config snapshot."""

    if selected_frames is not None:
        raise SystemExit("--frames on init-run is only supported for observed single-frame snapshots")

    parse_cycle(cycle)
    digest = product_config_digest(product_config)
    snapshot = RunSnapshot(
        metadata=run_metadata_from_env(product_config_digest=digest),
        pipeline=product_config.raw_pipeline_config,
        catalog=product_config.catalog,
    )
    env.artifact_repo.ensure_run_snapshot(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)


def _required_cycle(cycle: str | None) -> str:
    if cycle is None or not cycle.strip():
        raise SystemExit("--cycle is required for cycle-batch datasets")
    resolved = cycle.strip()
    parse_cycle(resolved)
    return resolved
