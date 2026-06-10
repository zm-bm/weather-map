"""Initialize immutable run snapshots."""

from __future__ import annotations

from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..state.runs.ids import parse_run_id
from ..state.runs.snapshots import LoadedRunSnapshot


def init_run(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    run_id: str,
) -> LoadedRunSnapshot:
    """Create or verify immutable run config/catalog snapshots."""

    parse_cycle(cycle)
    return env.ensure_run_snapshot(
        dataset_id=dataset_id,
        cycle=cycle,
        run_id=parse_run_id(run_id),
    )
