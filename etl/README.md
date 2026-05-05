# ETL

This directory owns the forecast artifact pipeline used by local development
and production.

`weather-map` is the source of truth for ETL application code:

- `forecast_etl/cli.py` runs local and Batch worker commands.
- `forecast_etl/aws/ingest.py` is the canonical production Lambda handler.
- `forecast.etl_config.json` is the dev/default pipeline config.
- `scripts/local/` contains local development helpers.
- `scripts/release/` builds production release artifacts.

Production deployment, production config, and AWS operator scripts live outside
this repo in the private infra checkout, under `stacks/weather-etl/`.

## Local Refresh

Run a full local cycle from the repo root:

```bash
etl/scripts/local/run-cycle.sh --cycle <cycle>
```

`<cycle>` is `YYYYMMDDHH`, for example `2026021606`.

The wrapper creates `etl/.venv` when the `forecast-etl` command is missing.
After changing ETL dependencies or tooling, update the local environment with:

```bash
etl/scripts/local/bootstrap.sh
```

That installs the ETL package from `etl/pyproject.toml` in editable mode. The
cycle script then checks for GDAL CLI tools and runs:

```bash
etl/.venv/bin/forecast-etl run-cycle --model gfs --cycle <cycle>
```

`run-cycle` reads `etl/forecast.etl_config.json`, acquires source GRIB files for
the selected model, processes each configured forecast hour, and writes
artifacts into the repo-level `artifacts/` directory.

## Product Pipeline

The ETL config is product-based:

- `product_catalog` defines shared scalar/vector products and encodings.
- `models.<model>.workload.products` is the ordered product list for that model.
- `models.<model>.products` maps catalog product components to model-specific GRIB metadata.
- `models.<model>.product_groups` groups products for frontend category/selection UI.

The implementation follows this path:

```text
GRIB band -> encoded component -> product payload -> manifest
```

- `forecast_etl/sources/` finds GRIB bands, extracts Float32 component bytes, and reads grid metadata.
- `forecast_etl/encoding/` defines encoding contracts and encodes component bytes.
- `forecast_etl/products/` packs encoded components and writes `.field.<dtype>.bin` payloads.
- `forecast_etl/manifest/` reads product success markers and emits frontend-compatible manifests.

## Artifact Layout

Local and production artifacts use the same object layout:

- `manifests/<model>/latest.json`
- `manifests/<model>/<cycle>.json`
- `fields/<model>/<cycle>/<fhour>/<product>.field.<dtype>.bin`
- `status/<model>/<cycle>/<product>/<fhour>._SUCCESS.json`
- `status/<model>/<cycle>/_PUBLISHED.json`
- `pmtiles/<name>.pmtiles`
- `radio/<track>.mp3`

In local development, `compose.yml` mounts `artifacts/` into nginx, which serves
`/manifests/*`, `/fields/*`, `/pmtiles/*`, and `/radio/*` on
`http://localhost:3000`.

## CLI Commands

Useful entrypoints:

```bash
etl/.venv/bin/forecast-etl run-cycle --model gfs --cycle <cycle>
etl/scripts/local/run-cycle.sh --model icon --cycle <cycle>
etl/.venv/bin/forecast-etl run-hour --model gfs --cycle <cycle> --fhour <fff> --source-uri <uri>
etl/.venv/bin/forecast-etl smoke
```

`run-hour` also accepts production Batch inputs from environment variables:

- `MODEL`
- `CYCLE`
- `FHOUR`
- `GRIB_SOURCE_URI`
- `ARTIFACT_ROOT_URI`
- `PIPELINE_CONFIG_URI`

`run-hour` publishes by default after processing the hour. Publishing is based on
success markers, so repeated publish attempts are idempotent.

## Production Release

Production flow:

1. NOAA publishes a GFS object notification.
2. SNS invokes `weather-etl-ingest-gfs`.
3. Lambda filters the object key using the production config in S3.
4. Lambda submits one AWS Batch job for each accepted `(cycle, fhour)`.
5. Batch runs the ETL image command `run-hour` and writes artifacts to S3.

Before planning or applying the production `weather-etl` stack, rebuild the
Lambda zip artifact from this repo:

```bash
etl/scripts/release/build-ingest-lambda-zip.sh
```

The Terraform stack consumes the generated artifact at:

```text
etl/dist/gfs-ingest-lambda.zip
```

Build and push the worker container image with:

```bash
etl/scripts/release/build-push-etl.sh
```

Production smoke and manual Batch helpers live with the Terraform stack:

```bash
stacks/weather-etl/ops/submit-smoke.sh
stacks/weather-etl/ops/submit-worker-job.sh
stacks/weather-etl/ops/invoke-lambda-test.sh
```

## Testing

Bootstrap the local environment first if `etl/.venv` does not exist:

```bash
etl/scripts/local/bootstrap.sh
```

Run ETL tests from the repo root:

```bash
etl/.venv/bin/python -m unittest discover -s etl/forecast_etl/tests -p 'test_*.py'
```

Run ETL linting from the repo root:

```bash
etl/.venv/bin/ruff check etl/forecast_etl
```

Run ETL type checking from the repo root:

```bash
etl/.venv/bin/pyright -p etl
```

Run only the production ingest tests:

```bash
etl/.venv/bin/python -m unittest discover -s etl/forecast_etl/tests -p 'test_aws_ingest.py'
```
