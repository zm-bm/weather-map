# Forecast ETL

Forecast artifact pipeline shared by local development and production Batch.

## Key Files

- `forecast.etl_config.json`: default local pipeline config.
- `forecast_etl/`: ETL package.
- `Dockerfile`: worker image used by local runs and AWS Batch.
- `scripts/run-cycle.sh`: local cycle runner.
- `scripts/bootstrap.sh`: optional repo-root venv setup for tests and direct CLI work.

## Local Runs

Local cycle runs go through the worker container. The host only needs Docker;
GDAL, CDO, eccodes, and ICON regrid assets live in the image.

```bash
etl/scripts/run-cycle.sh --model gfs --cycle <YYYYMMDDHH>
etl/scripts/run-cycle.sh --model icon --cycle <YYYYMMDDHH>
```

The script prepares `weather-map-forecast-etl:local`, resolves configured
forecast hours inside that image, then runs one `forecast-etl run-hour`
container per forecast hour. It automatically rebuilds the image when the ETL
Dockerfile, package code, package metadata, or forecast config changes; use
`--rebuild` to force a rebuild when needed.

Local outputs are written under the repo-level `artifacts/` directory.
Downloads and prepared GRIB files are cached under `etl/cache/`.

## Direct CLI

Use the venv only when you want to run the package directly for development or
tests:

```bash
etl/scripts/bootstrap.sh
.venv/bin/forecast-etl list-forecast-hours --model <model>
```

Normal local cycle execution should use `scripts/run-cycle.sh`, not the host
CLI.

## Pipeline Shape

The config is model-aware:

- `models.gfs` reads NOAA GFS data.
- `models.icon` reads DWD ICON data and regrids it inside the worker image.
- `models.<model>.workload` controls forecast hours and products.

Each `run-hour` writes product payloads and success markers. Publishing is
marker-based and idempotent.

```text
source adapter -> prepared GRIB -> product payloads -> success markers -> cycle manifest
```

## Artifacts

```text
fields/<model>/<cycle>/<fhour>/<product>.field.<dtype>.bin
status/<model>/<cycle>/<product>/<fhour>._SUCCESS.json
status/<model>/<cycle>/_PUBLISHED.json
manifests/<model>/<cycle>.json
manifests/<model>/latest.json
```

## Checks

```bash
.venv/bin/python -m unittest discover -s etl/forecast_etl/tests
cd etl
../.venv/bin/ruff check forecast_etl
```
