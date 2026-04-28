# ETL

This directory owns the GFS forecast artifact pipeline used by local development
and production.

`weather-map` is the source of truth for ETL application code:

- `gfs_pipeline/cli.py` runs local and Batch worker commands.
- `gfs_pipeline/aws/ingest.py` is the canonical production Lambda handler.
- `gfs.etl_config.json` is the dev/default pipeline config.
- `scripts/local/` contains local development helpers.
- `scripts/release/` builds production release artifacts.

Production deployment, production config, and AWS operator scripts live outside
this repo in the private infra checkout, under `stacks/weather-etl/`.

## Local Refresh

Run a full local cycle from the repo root:

```bash
etl/scripts/local/run-cycle.sh <cycle>
```

`<cycle>` is `YYYYMMDDHH`, for example `2026021606`.

The script creates/updates `etl/.venv`, installs `etl/requirements.txt`, checks
for GDAL CLI tools, then runs:

```bash
python -m gfs_pipeline.cli run-cycle --cycle <cycle>
```

`run-cycle` reads `etl/gfs.etl_config.json`, downloads GRIB files from NOMADS
into `etl/cache/grib/<cycle>/`, processes each configured forecast hour, and
writes artifacts into the repo-level `artifacts/` directory.

## Artifact Layout

Local and production artifacts use the same object layout:

- `manifests/latest.json`
- `manifests/<cycle>.json`
- `fields/<cycle>/<fhour>/<layer>.scalar.<dtype>.bin`
- `fields/<cycle>/<fhour>/<layer>.vector.i8.bin`
- `status/<cycle>/<layer>/<fhour>._SUCCESS.json`
- `status/<cycle>/_PUBLISHED.json`
- `pmtiles/<name>.pmtiles`
- `radio/<track>.mp3`

In local development, `compose.yml` mounts `artifacts/` into nginx, which serves
`/manifests/*`, `/fields/*`, `/pmtiles/*`, and `/radio/*` on
`http://localhost:3000`.

## CLI Commands

Useful entrypoints:

```bash
python -m gfs_pipeline.cli run-cycle --cycle <cycle>
python -m gfs_pipeline.cli run-hour --cycle <cycle> --fhour <fff> --source-uri <uri>
python -m gfs_pipeline.cli smoke
```

`run-hour` also accepts production Batch inputs from environment variables:

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

Run ETL tests from `etl/`:

```bash
python -m unittest discover -s gfs_pipeline/tests -p 'test_*.py'
```

Run only the production ingest tests:

```bash
python -m unittest discover -s gfs_pipeline/tests -p 'test_aws_ingest.py'
```
