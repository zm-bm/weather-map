# Forecast ETL

Forecast artifact pipeline shared by local development and production Batch.

## Key Files

- `../config/pipeline/base.json`: production pipeline config source.
- `../config/pipeline/local.json`: local pipeline override.
- `../config/forecast_catalog.json`: canonical forecast layer catalog.
- `forecast_etl/`: ETL package.
- `Dockerfile`: worker image used by local runs and AWS Batch.
- `scripts/run-cycle.sh`: local cycle runner.
- `scripts/bootstrap.sh`: optional repo-root venv setup for tests and direct CLI work.

## Local Runs

Local cycle runs go through the worker container. The host only needs Docker;
GDAL, CDO, eccodes, and ICON regrid assets live in the image.

```bash
etl/scripts/run-cycle.sh --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --model gfs --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --model icon --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --cycle <YYYYMMDDHH> --artifact cloud_layers --artifact wind10m_uv
```

The script prepares `weather-map-forecast-etl:local`, creates one run-scoped
config/catalog snapshot, resolves configured forecast hours from that snapshot,
then runs one `forecast-etl run-hour` container per forecast hour and one final
`forecast-etl validate-cycle` per model. It then runs one final
`forecast-etl publish-cycle` per model unless `--no-publish` is set. Omitting
`--model` refreshes every configured model sequentially. `--no-publish`
suppresses only public manifest publication; validation still runs. It automatically
rebuilds the image when the ETL Dockerfile, package code, package metadata, or
forecast config changes; use `--rebuild` to force a rebuild when needed.

Local outputs are written under the repo-level `artifacts/` directory.
Downloads and prepared GRIB files are cached under `etl/cache/`.
Use repeatable `--artifact` filters for local iteration when only specific
artifacts need to be regenerated. Validation still checks full-workload
readiness, so a fresh filtered run is expected to fail validation unless the
remaining artifacts already exist under the same run id.

Each local cycle run gets one run id in `YYYYMMDDTHHMMSSZ-<8hex>` format. The
script generates it by default and passes the same `RUN_ID` to every hour
container and the final publisher. Use `--run-id <run_id>` only when
intentionally resuming or reproducing the same attempt.

Local reruns are the fastest way to validate ETL changes before a production
deploy:

```bash
etl/scripts/run-cycle.sh --model gfs --cycle <YYYYMMDDHH> --dry-run
etl/scripts/run-cycle.sh --model gfs --cycle <YYYYMMDDHH>
```

The dry run should show the same `RUN_ID` on every `run-hour` command, one
`init-run` command before the workers, one `validate-cycle` command after the
workers, and one final `publish-cycle` command unless `--no-publish` is set.
A real local run exercises the worker image, run snapshot, success markers,
validation gate, publish readiness checks, and frontend manifest contract
without requiring Lambda, Batch, or Terraform changes.

## Direct CLI

Use the venv only when you want to run the package directly for development or
tests:

```bash
etl/scripts/bootstrap.sh
.venv/bin/forecast-etl list-models
.venv/bin/forecast-etl list-forecast-hours --model <model>
.venv/bin/forecast-etl init-run --model <model> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/forecast-etl run-hour --model <model> --cycle <YYYYMMDDHH> --run-id <run_id> --fhour <FFF>
.venv/bin/forecast-etl validate-cycle --model <model> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/forecast-etl publish-cycle --model <model> --cycle <YYYYMMDDHH>
```

Normal local cycle execution should use `scripts/run-cycle.sh`, not the host
CLI.

`--pipeline-config-uri` and `--forecast-catalog-uri` can point at either source
config/catalog files or the pinned copies under `runs/<model>/<cycle>/<run_id>/config/`.
`run-hour`, `validate-cycle`, and `publish-cycle` should use the pinned run
snapshot once it exists. `publish-cycle` refuses runs without a passing
`validation.json`.

## Pipeline Shape

The config is model-aware:

- `models.gfs` reads NOAA GFS data.
- `models.icon` reads DWD ICON data and regrids it inside the worker image.
- `models.<model>.workload` controls forecast hours and artifact ids.

Each `run-hour` writes artifact payloads and success markers. New success
markers include a strict `run_id` plus provenance fields for model, code
revision, image identity, and config digest. Validation reads the run snapshot
and success markers, writes `validation.json`, and currently verifies marker
metadata without re-reading payload bytes. Publishing is marker-based and
idempotent; it refuses incomplete cycles, cycles whose expected markers are
missing or mixed across run ids, and runs without a passing validation report.
Publishing writes immutable run manifests and promotes by small public pointers;
direct `manifests/<model>/latest.json` reads now return a pointer, not a full
cycle manifest.

```text
source adapter -> prepared GRIB -> artifact payloads -> success markers -> validation -> run manifest -> pointers
```

The cycle manifest is artifact-only: it advertises produced scalar/vector
artifacts, decode metadata, compact payload refs, and model/run identity.
User-facing layer groups, labels, palettes, display ranges, unit behavior, and
derived frontend layer recipes live in the frontend forecast catalog.

The public manifest includes compact payload references instead of thousands of
per-frame payload paths:

```text
run.payloadRoot = runs/<model>/<cycle>/<run_id>/fields
artifact.payloadFile = <artifact>.field.<dtype>.bin
frontend path = <payloadRoot>/<fhour>/<payloadFile>
```

Legacy frontend code can still infer `fields/<model>/<cycle>/<fhour>/...` for
older public manifests. New ETL output is run-scoped and immutable enough that
multiple attempts for the same cycle can coexist.

## Artifacts

```text
runs/<model>/<cycle>/<run_id>/run.json
runs/<model>/<cycle>/<run_id>/config/pipeline_config.json
runs/<model>/<cycle>/<run_id>/config/forecast_catalog.json
runs/<model>/<cycle>/<run_id>/fields/<fhour>/<artifact>.field.<dtype>.bin
runs/<model>/<cycle>/<run_id>/status/<artifact>/<fhour>._SUCCESS.json
runs/<model>/<cycle>/<run_id>/validation.json
runs/<model>/<cycle>/<run_id>/manifest.json
runs/<model>/<cycle>/<run_id>/_PUBLISHED.json
manifests/<model>/cycles/<cycle>/runs/<run_id>.json
manifests/<model>/cycles/<cycle>/current.json
manifests/<model>/latest.json
manifests/forecast-manifest.json
```

`manifests/<model>/latest.json` has schema
`weather-map.model-latest-pointer` and `current.json` has schema
`weather-map.model-cycle-current-pointer`; both point at the immutable public
run manifest under `manifests/<model>/cycles/.../runs/...`.

## Checks

```bash
.venv/bin/python -m unittest discover -s etl/forecast_etl/tests
cd etl
../.venv/bin/ruff check forecast_etl
```
