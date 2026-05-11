# Weather ETL Stack

Production forecast ETL infrastructure for GFS and ICON.

## Flow

GFS is event-driven:

1. NOAA publishes a GFS object notification to SNS.
2. `weather-etl-ingest-gfs` filters the object key against the shared ETL
   config.
3. The Lambda submits one Batch `run-hour` job for the accepted `(cycle, fhour)`.
4. The worker reads the NOAA S3 object, writes artifacts, and attempts publish.

ICON is polled:

1. EventBridge invokes `weather-etl-ingest-icon` every 10 minutes.
2. The Lambda checks only the latest `00/06/12/18 UTC` DWD ICON cycle
   (`ICON_POLL_CYCLE_COUNT=1`).
3. It waits for sentinel `f000` files, verifies required files for each
   configured forecast hour, and uses DynamoDB leases to avoid duplicate
   submissions.
4. Batch workers download ICON files from DWD, decompress, regrid with direct
   CDO, write artifacts, and attempt publish.

Both models use the same worker image and the same shared pipeline config.

## Source Data

- GFS: `s3://noaa-gfs-bdp-pds`
  - https://registry.opendata.aws/noaa-gfs-bdp-pds/
  - https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- ICON global: DWD Open Data
  - https://opendata.dwd.de/weather/nwp/icon/grib/

## Config

Terraform uploads the production ETL config and passes the same URI to Lambda
and Batch:

```text
PIPELINE_CONFIG_URI=s3://<config-bucket>/weather-etl/pipeline_config.json
```

Forecast hours and product lists come from `models.<model>.workload` in that
config. Changes to `infra/config/forecast.etl_config.json` are deployed through
this stack so the S3 config object is updated.

## Deploy

From the repo root, build the shared Lambda artifact before deploying Lambda
code changes:

```bash
infra/scripts/weather-etl/release/build-ingest-lambda-zip.sh
```

From the repo root, push the worker image after ETL code or dependency changes:

```bash
infra/scripts/weather-etl/release/build-push-worker-image.sh
```

The Lambda artifact is shared by both ingest Lambdas:

```text
etl/dist/weather-etl-ingest-lambda.zip
```

The worker image contains GDAL, CDO, eccodes tools, and ICON regrid assets.

## Operations

From the repo root, manually submit a production cycle:

```bash
infra/scripts/weather-etl/ops/submit-cycle.sh --cycle YYYYMMDDHH --model gfs
infra/scripts/weather-etl/ops/submit-cycle.sh --cycle YYYYMMDDHH --model icon
```

Enable or disable ICON polling:

```bash
aws events enable-rule --name weather-etl-ingest-icon-poll
aws events disable-rule --name weather-etl-ingest-icon-poll
```

Useful live logs:

```bash
aws logs tail /aws/lambda/weather-etl-ingest-icon --since 2h --follow
aws logs tail /aws/batch/weather-etl --since 2h --follow
```

Batch queue spot check:

```bash
aws batch list-jobs --job-queue weather-etl --job-status RUNNING
aws batch list-jobs --job-queue weather-etl --job-status FAILED
```
