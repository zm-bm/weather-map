# Forecast ETL

ETL package and worker image for forecast-like datasets such as GFS and ICON.
Local development and production submission both run through the same cycle
planning/executor path.

## Key Files

- `../config/pipeline/base.json`: production pipeline config source.
- `../config/pipeline/local.json`: local pipeline override.
- `../config/forecast_catalog.json`: canonical forecast layer catalog.
- `forecast_etl/`: ETL package.
- `Dockerfile`: Batch/local worker image.
- `scripts/run-cycle.sh`: local cycle runner.
- `scripts/bootstrap.sh`: optional repo-root venv setup for tests and direct CLI work.

## Local Runs

Local cycle runs use Docker for frame workers. The host wrapper builds or
refreshes `weather-map-forecast-etl:local`, then delegates execution to
`forecast-etl execute-local-cycle`.

```bash
etl/scripts/run-cycle.sh --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --dataset-id gfs --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --dataset-id icon --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --cycle <YYYYMMDDHH> --frames "000 003" --artifact cloud_layers
```

Omitting `--run-id` creates a new attempt. Passing `--run-id <run_id>` resumes
that run and skips frames whose marker evidence is already complete. Local runs
do not use persistent frame claims.

The local executor runs:

```text
init-run -> plan-cycle -> pending run-frame containers -> validate-cycle -> optional publish-cycle
```

`--no-publish` suppresses only public manifest publication; validation still
runs. `--dry-run` prints the planned containers and final validate/publish
steps without writing artifacts. `--artifact` can narrow local iteration, but a
fresh filtered run is expected to fail validation unless the other required
artifacts already exist under the same run id.

Local outputs are written under the repo-level `artifacts/` directory.
Downloads and prepared GRIB files are cached under `etl/cache/`.

## Direct CLI

Use the venv for development, tests, and operator inspection:

```bash
etl/scripts/bootstrap.sh
.venv/bin/forecast-etl list-datasets
.venv/bin/forecast-etl list-frames --dataset-id <dataset_id>
.venv/bin/forecast-etl init-run --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/forecast-etl plan-cycle --dataset-id <dataset_id> --cycle <YYYYMMDDHH> [--run-id <run_id>] --json
.venv/bin/forecast-etl run-frame --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id> --frame-id <FFF>
.venv/bin/forecast-etl validate-cycle --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/forecast-etl publish-cycle --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/forecast-etl runs --dataset-id <dataset_id> --cycle <YYYYMMDDHH>
.venv/bin/forecast-etl status --dataset-id <dataset_id> --cycle <YYYYMMDDHH> [--run-id <run_id>]
.venv/bin/forecast-etl pointers --dataset-id <dataset_id> [--cycle <YYYYMMDDHH>]
.venv/bin/forecast-etl cleanup-runs --dataset-id <dataset_id> [--cycle <YYYYMMDDHH>] [--json]
```

`run-frame`, `validate-cycle`, and `publish-cycle` should use the run snapshot
config/catalog URIs once the snapshot exists. `publish-cycle` refuses runs
without a passing `validation.json`.

The operator inspection commands are read-only except
`cleanup-runs --delete --yes`, which deletes only cleanup-candidate
`runs/<dataset_id>/<cycle>/<run_id>/` prefixes.

## Pipeline Shape

The config is dataset-aware:

- `datasets.gfs` reads NOAA GFS data.
- `datasets.icon` reads DWD ICON data and regrids it inside the worker image.
- `datasets.<dataset_id>.workload` controls frame ids and artifact ids.

Each `run-frame` writes field payloads and success markers. Markers include
`dataset_id`, `cycle`, `run_id`, `frame_id`, artifact metadata, code revision,
image identity, and config digest. Validation reads the run snapshot and marker
metadata, writes `validation.json`, and remains the publication gate.

Production/manual AWS submission is resume-aware:

- omitted `--run-id` creates a new run attempt
- explicit `--run-id` resumes an existing run
- complete frames are skipped from marker evidence
- active DynamoDB frame claims suppress duplicate submissions
- expired claims allow retry

```text
source adapter -> prepared GRIB -> field payloads -> success markers -> validation -> run manifest -> pointers
```

Public manifests use compact run-first payload references:

```text
run.payload_root = runs/<dataset_id>/<cycle>/<run_id>/fields
artifact.payload_file = <artifact>.field.<dtype>.bin
frontend path = <payload_root>/<frame_id>/<payload_file>
```

## Artifacts

```text
runs/<dataset_id>/<cycle>/<run_id>/run.json
runs/<dataset_id>/<cycle>/<run_id>/config/pipeline_config.json
runs/<dataset_id>/<cycle>/<run_id>/config/forecast_catalog.json
runs/<dataset_id>/<cycle>/<run_id>/fields/<frame_id>/<artifact>.field.<dtype>.bin
runs/<dataset_id>/<cycle>/<run_id>/status/<artifact>/<frame_id>._SUCCESS.json
runs/<dataset_id>/<cycle>/<run_id>/validation.json
runs/<dataset_id>/<cycle>/<run_id>/manifest.json
runs/<dataset_id>/<cycle>/<run_id>/_PUBLISHED.json
manifests/<dataset_id>/cycles/<cycle>/runs/<run_id>.json
manifests/<dataset_id>/cycles/<cycle>/current.json
manifests/<dataset_id>/latest.json
manifests/data-manifest.json
```

`latest.json` has schema `weather-map.dataset-latest-pointer`, and
`current.json` has schema `weather-map.dataset-cycle-current-pointer`.

## Checks

```bash
cd etl && ../.venv/bin/python -m unittest discover forecast_etl/tests
cd etl && ../.venv/bin/ruff check forecast_etl
```
