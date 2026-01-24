from pathlib import Path

from .paths import RepoPaths
from .models import Plan, JobContext
from .backend import ExecutionBackend
from .revision import compute_revision
from .manifest import write_manifests
from .io_utils import (
    parse_cycle,
    nomads_url,
    download_if_needed,
    load_json_file,
    validate_run_config,
)


def make_plan(*, cycle: str, config_path: str | Path, layer_config_path: str | Path) -> Plan:
    run_config_obj = load_json_file(Path(config_path), what="Run config")
    layer_config_obj = load_json_file(Path(layer_config_path), what="Layer config")

    cfg = validate_run_config(run_config_obj)
    revision = compute_revision(cycle=cycle, run_config=cfg, layer_config_obj=layer_config_obj)
    return Plan(cycle=cycle, revision=revision, cfg=cfg)


def run_hour(*, plan: Plan, fhr: str, paths: RepoPaths, backend: ExecutionBackend, force_download: bool = False) -> None:
    cycle_date, cycle_hour = parse_cycle(plan.cycle)

    cache_dir = paths.data_dir / "grib_cache" / plan.cycle
    cache_dir.mkdir(parents=True, exist_ok=True)

    base_url = plan.cfg["nomads"]["base_url"]
    vars_levels = plan.cfg["nomads"]["vars_levels"]

    url = nomads_url(
        base_url=base_url,
        vars_levels=vars_levels,
        cycle_date=cycle_date,
        cycle_hour=cycle_hour,
        fhr=fhr,
    )
    grib_name = f"gfs.t{cycle_hour}z.pgrb2.0p25.f{fhr}"
    grib_path = cache_dir / grib_name

    download_if_needed(url, grib_path, force=bool(force_download))

    grib_relpath = Path("grib_cache") / plan.cycle / grib_name
    for layer in plan.cfg["layers"]:
        backend.run_layer(
            ctx=JobContext(
                out_dir=paths.out_dir,
                data_dir=paths.data_dir,
                cycle=plan.cycle,
                fhr=fhr,
                layer=layer,
                grib_relpath=grib_relpath,
                min_zoom=plan.cfg["min_zoom"],
                max_zoom=plan.cfg["max_zoom"],
            )
        )


def finalize(*, plan: Plan, paths: RepoPaths, backend: ExecutionBackend, sync_tiles: bool = True) -> None:
    manifests_out = write_manifests(etl_dir=paths.etl_dir, cycle=plan.cycle, cfg=plan.cfg, revision=plan.revision)
    backend.finalize(sync=bool(sync_tiles), manifest=True, manifests_out=manifests_out)

