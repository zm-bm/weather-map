import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from io_utils import parse_cycle

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def write_manifests(*, etl_dir: Path, cycle: str, cfg: dict[str, Any], revision: str) -> Path:
    cycle_date, cycle_hour = parse_cycle(cycle)

    manifests_out = etl_dir / "out" / "manifests"
    manifests_out.mkdir(parents=True, exist_ok=True)

    generated_at = utc_now_iso()
    cycle_manifest = {
        "version": 1,
        "cycle": cycle,
        "cycle_date": cycle_date,
        "cycle_hour": cycle_hour,
        "generated_at": generated_at,
        "revision": revision,
        "forecast_hours": cfg["hours"],
        "layers": cfg["layers"],
        "variables_levels": cfg["nomads"]["vars_levels"],
        "min_zoom": cfg["min_zoom"],
        "max_zoom": cfg["max_zoom"],
    }

    (manifests_out / f"{cycle}.json").write_text(
        json.dumps(cycle_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    latest_manifest = {"cycle": cycle, "generated_at": generated_at, "revision": revision}
    (manifests_out / "latest.json").write_text(
        json.dumps(latest_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    return manifests_out
