"""Initialize immutable run snapshots."""

from __future__ import annotations

from collections.abc import Iterable

from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..state.runs.snapshots import LoadedRunSnapshot
from .run_layouts import ensure_run_snapshot


def init_run(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str,
    selected_frames: Iterable[str] | None = None,
) -> LoadedRunSnapshot:
    """Create or verify immutable run config/catalog snapshots."""

    parse_cycle(cycle)
    product_config = env.load_product_config()
    return ensure_run_snapshot(
        env=env,
        product_config=product_config,
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=run_id,
        selected_frames=selected_frames,
    )
