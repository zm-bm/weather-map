import json
import shutil
import subprocess
import urllib.request
from pathlib import Path
from typing import Any


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=str(cwd) if cwd else None)

def parse_cycle(cycle: str) -> tuple[str, str]:
    if len(cycle) != 10 or not cycle.isdigit():
        raise SystemExit("cycle must be YYYYMMDDHH (10 digits), e.g. 2026011412")
    return cycle[:8], cycle[8:10]


def load_json_file(path: Path, *, what: str) -> Any:
    if not path.exists():
        raise SystemExit(f"{what} not found: {path}.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise SystemExit(f"Failed to parse {what} JSON {path}: {e}") from e


def validate_run_config(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise SystemExit("run_config.json must be a JSON object.")

    layers = obj.get("layers")
    hours = obj.get("hours")
    min_zoom = obj.get("min_zoom")
    max_zoom = obj.get("max_zoom")

    nomads = obj.get("nomads") if isinstance(obj.get("nomads"), dict) else {}
    base_url = nomads.get("base_url") or obj.get("base_url")
    vars_levels = nomads.get("vars_levels") or obj.get("vars_levels")

    if not isinstance(layers, list) or not all(isinstance(x, str) and x for x in layers):
        raise SystemExit("run_config.json: 'layers' must be a list of strings.")
    if not isinstance(hours, list) or not all(isinstance(x, str) and x.isdigit() and len(x) == 3 for x in hours):
        raise SystemExit("run_config.json: 'hours' must be a list of 'FFF' strings (e.g. '003').")
    if not isinstance(min_zoom, int) or not isinstance(max_zoom, int):
        raise SystemExit("run_config.json: 'min_zoom' and 'max_zoom' must be integers.")
    if not isinstance(base_url, str) or not base_url:
        raise SystemExit("run_config.json: 'nomads.base_url' must be a non-empty string.")
    if not isinstance(vars_levels, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in vars_levels.items()):
        raise SystemExit("run_config.json: 'nomads.vars_levels' must be an object of string->string.")

    return {
        "layers": layers,
        "hours": hours,
        "min_zoom": min_zoom,
        "max_zoom": max_zoom,
        "nomads": {
            "base_url": base_url,
            "vars_levels": vars_levels,
        },
    }


def nomads_url(*, base_url: str, vars_levels: dict[str, str], cycle_date: str, cycle_hour: str, fhr: str) -> str:
    params = {
        "dir": f"/gfs.{cycle_date}/{cycle_hour}/atmos",
        "file": f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhr}",
        **vars_levels,
    }
    return f"{base_url}?{urllib.parse.urlencode(params)}"


def download_if_needed(url: str, out_path: Path, *, force: bool = False) -> None:
    if out_path.exists() and not force:
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")

    print(f"Downloading {url} -> {out_path}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "weather-map-etl/1.0"})

    try:
        with urllib.request.urlopen(req) as resp:
            status = getattr(resp, "status", 200)
            if status != 200:
                raise RuntimeError(f"HTTP {status} for {url}")
            with open(tmp_path, "wb") as f:
                shutil.copyfileobj(resp, f)
        tmp_path.replace(out_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)

