# Forecast ETL

This directory contains the forecast artifact pipeline used by local
development and production Batch workers.

Core files:

- `forecast.etl_config.json`: default ETL config for local runs.
- `forecast_etl/`: Python package for config parsing, source acquisition,
  product encoding, marker writing, and manifest publishing.
- `scripts/local/`: local bootstrap and cycle-refresh scripts.
- `scripts/release/`: production Lambda/container build helpers.
- `Dockerfile`: worker image entrypoint for AWS Batch.

Production deployment config and operator scripts live in the private infra
checkout under `stacks/weather-etl/`.

## Local Setup

Bootstrap the ETL virtual environment from the repo root:

```bash
etl/scripts/local/bootstrap.sh
```

This creates `etl/.venv` if needed and installs `etl/pyproject.toml` in editable
mode with dev tools.

Local cycle runs require GDAL CLI tools on `PATH`:

```bash
gdalinfo
gdal_translate
gdalwarp
```

ICON local runs also require Docker for the configured regridding image.

## Local Run

Run one complete model cycle:

```bash
etl/scripts/local/run-cycle.sh --model gfs --cycle <YYYYMMDDHH>
```

Examples:

```bash
etl/scripts/local/run-cycle.sh --cycle 2026021606
etl/scripts/local/run-cycle.sh --model icon --cycle 2026021606 --procs 1
```

The wrapper bootstraps the venv if needed, validates host prerequisites, and
runs:

```bash
etl/.venv/bin/forecast-etl run-cycle --model <model> --cycle <cycle>
```

By default local artifacts are written under the repo-level `artifacts/`
directory. The local dev stack serves those artifacts from nginx.

## CLI

Useful commands:

```bash
etl/.venv/bin/forecast-etl run-cycle --model gfs --cycle <YYYYMMDDHH>
etl/.venv/bin/forecast-etl run-hour --model gfs --cycle <YYYYMMDDHH> --fhour <FFF> --source-uri <uri>
etl/.venv/bin/forecast-etl smoke
```

Common runtime inputs:

- `--pipeline-config-uri`: config URI, defaults to `etl/forecast.etl_config.json`.
- `--artifact-root-uri`: artifact root URI, defaults to repo `artifacts/`.
- `--model`: configured model id, for example `gfs` or `icon`.
- `--cycle`: forecast cycle as `YYYYMMDDHH`.
- `--fhour`: forecast hour as `FFF`.
- `--source-uri`: optional source GRIB URI for `run-hour`.

Batch workers can provide the same values through:

```text
PIPELINE_CONFIG_URI
ARTIFACT_ROOT_URI
MODEL
CYCLE
FHOUR
GRIB_SOURCE_URI
```

`run-hour` publishes after processing the hour unless `--no-publish` is set.
Publishing is marker-based and idempotent for the same manifest revision.

## Pipeline Shape

The ETL config is product-based:

- `product_catalog` defines shared product metadata, components, styles, and
  encodings.
- `models.<model>.source` defines source acquisition settings.
- `models.<model>.workload` defines forecast hours and product order.
- `models.<model>.products` maps product components to model-specific GRIB
  metadata.
- `models.<model>.product_groups` defines frontend product groupings.

Runtime flow:

```text
model source -> prepared GRIB source -> product payloads -> success markers -> cycle manifest
```

Package responsibilities:

- `config/`: strict `etl_config.json` parsing and resolved config models.
- `models/`: model-specific source acquisition adapters.
- `sources/`: GDAL, GRIB, NOMADS, and prepared-source helpers.
- `encoding/`: binary payload encoding contracts.
- `products/`: component extraction, encoding, payload writing, marker metadata.
- `artifacts/`: artifact paths, JSON helpers, and success marker contracts.
- `manifest/`: success marker validation, manifest assembly, publish logic.
- `pipeline/`: run-hour and run-cycle orchestration.
- `aws/`: Lambda ingest entrypoint.

## Artifacts

The ETL writes this object layout under the artifact root:

```text
fields/<model>/<cycle>/<fhour>/<product>.field.<dtype>.bin
status/<model>/<cycle>/<product>/<fhour>._SUCCESS.json
status/<model>/<cycle>/_PUBLISHED.json
manifests/<model>/<cycle>.json
manifests/<model>/latest.json
```

Field payloads are raw packed binary arrays. Success markers are the publish
contract between product execution and manifest assembly. Cycle manifests are
the frontend-facing index over grids, encodings, products, frames, and times.

## Production

Production flow:

1. NOAA publishes a GFS object notification.
2. SNS invokes the ingest Lambda.
3. Lambda filters the S3 key using the configured workload.
4. Lambda submits an AWS Batch `run-hour` job for accepted objects.
5. Batch writes field payloads, success markers, and manifests to S3.

Build the ingest Lambda zip:

```bash
etl/scripts/release/build-ingest-lambda-zip.sh
```

The generated artifact is:

```text
etl/dist/gfs-ingest-lambda.zip
```

Build and push the worker image:

```bash
etl/scripts/release/build-push-etl.sh
```

Production smoke and manual Batch helpers are kept with the Terraform stack in
`stacks/weather-etl/ops/`.

## Testing

Run all ETL tests:

```bash
etl/.venv/bin/python -m unittest discover -s etl/forecast_etl/tests
```

Run static checks:

```bash
cd etl
.venv/bin/ruff check forecast_etl
.venv/bin/pyright
```

Targeted examples:

```bash
etl/.venv/bin/python -m unittest etl.forecast_etl.tests.test_config_parse
etl/.venv/bin/python -m unittest etl.forecast_etl.tests.test_manifest_publish
etl/.venv/bin/python -m unittest etl.forecast_etl.tests.test_products_execute
```
