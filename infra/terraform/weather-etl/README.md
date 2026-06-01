# Weather ETL Stack

Production forecast ETL infrastructure for GFS and ICON.

## Flow

GFS is event-driven:

1. NOAA publishes a GFS object notification to SNS.
2. `weather-etl-ingest-gfs` filters the object key shape and synoptic cycle.
3. The Lambda gets or creates one run id for the accepted model cycle in the
   run coordinator table.
4. The Lambda creates or reads that run's config/catalog snapshot, filters the
   forecast hour against the snapshot workload, and submits one Batch
   `run-hour` job with the shared `RUN_ID` and pinned snapshot URIs.
5. The worker reads the NOAA S3 object and writes field artifacts plus success
   markers.

ICON is polled:

1. EventBridge invokes `weather-etl-ingest-icon` every 10 minutes.
2. The Lambda checks only the latest `00/06/12/18 UTC` DWD ICON cycle
   (`ICON_POLL_CYCLE_COUNT=1`).
3. It waits for sentinel `f000` files, verifies required files for each
   configured forecast hour, and uses DynamoDB leases to avoid duplicate
   submissions.
4. The Lambda gets or creates one run id for the model cycle, creates or reads
   that run's config/catalog snapshot, and uses that snapshot for readiness and
   completion checks before submitting hour jobs.
5. Batch workers download ICON files from DWD, decompress, regrid with direct
   CDO, and write field artifacts plus success markers.

Publication is scheduled separately:

1. EventBridge invokes `weather-etl-publisher` every 10 minutes.
2. The publisher checks recent synoptic cycles for configured models.
3. Complete runs are validated into run-scoped `validation.json` reports when
   needed.
4. Runs with passing validation publish model manifest aliases, the run-scoped
   `_PUBLISHED.json`, and the aggregate frontend forecast manifest.

Both models use the same worker image. Each run uses pinned copies of the
pipeline config and forecast catalog stored under its run prefix.

New ETL output is grouped by run:

```text
runs/<model>/<cycle>/<run_id>/
  run.json
  config/pipeline_config.json
  config/forecast_catalog.json
  fields/<fhour>/<artifact>.field.<dtype>.bin
  status/<artifact>/<fhour>._SUCCESS.json
  validation.json
  manifest.json
  _PUBLISHED.json
```

Public aliases remain under `manifests/`, and legacy `/fields/*` payloads stay
available while old public manifests age out.

Automatic GFS and ICON ingest share a small DynamoDB run coordinator table:

```text
pk = <model>#<cycle>
runId = YYYYMMDDTHHMMSSZ-<8hex>
ttl = 14 days by default
```

The table is intentionally only a run-id coordinator, not full orchestration
state. It prevents individual GFS SNS events or ICON poll submissions for the
same cycle from fragmenting into separate run ids.

## Source Data

- GFS: `s3://noaa-gfs-bdp-pds`
  - https://registry.opendata.aws/noaa-gfs-bdp-pds/
  - https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- ICON global: DWD Open Data
  - https://opendata.dwd.de/weather/nwp/icon/grib/

## Config

Terraform uploads the production ETL config and forecast catalog. Ingest
Lambdas and manual submit tooling use these deployed objects as the source of
truth when creating a run snapshot:

```text
PIPELINE_CONFIG_URI=s3://<config-bucket>/weather-etl/pipeline_config.json
FORECAST_CATALOG_URI=s3://<config-bucket>/weather-etl/forecast_catalog.json
```

Forecast hours and produced artifact ids come from `models.<model>.workload` in
that config. Changes to `config/pipeline/base.json` or
`config/forecast_catalog.json` are deployed through this stack so the S3 source
objects are updated.

## Deploy

Production deploys should be coordinated across the worker image, Lambda zip,
and Terraform. New workers require `RUN_ID`, and the ingest Lambdas/Terraform
provide the run coordinator table and container overrides. Local ETL reruns are
fine for validating intermediate task work; bundle related ETL hardening tasks
into one production deploy when that is less operationally painful.

From the repo root, build the shared Lambda artifact before deploying Lambda
code changes:

```bash
infra/scripts/weather-etl/release/build-ingest-lambda-zip.sh
```

From the repo root, push the worker image after ETL code or dependency changes:

```bash
infra/scripts/weather-etl/release/build-push-worker-image.sh
```

The Lambda artifact is shared by the ingest and publisher Lambdas:

```text
etl/dist/weather-etl-ingest-lambda.zip
```

The worker image contains GDAL, CDO, eccodes tools, and ICON regrid assets.

After building the Lambda zip and pushing the worker image, apply this stack so
the ingest/publisher Lambdas, EventBridge rules, IAM, config/catalog objects,
Batch job definitions, and run coordinator table are all current:

```bash
cd infra/terraform/weather-etl
terraform plan
terraform apply
```

## Operations

From the repo root, manually submit a production cycle:

```bash
infra/scripts/weather-etl/ops/submit-cycle.sh --cycle YYYYMMDDHH --model gfs
infra/scripts/weather-etl/ops/submit-cycle.sh --cycle YYYYMMDDHH --model icon
```

Manual submits generate one run id per submitted cycle unless `--run-id` or
`RUN_ID` is supplied. Before submitting workers, the script creates a run
snapshot from the deployed Terraform-managed config/catalog and passes those
run snapshot URIs to every Batch job. Use `--dry-run` to verify the same
`RUN_ID` and snapshot URIs before touching Batch:

```bash
infra/scripts/weather-etl/ops/submit-cycle.sh --cycle YYYYMMDDHH --model gfs --dry-run
```

Publication is handled by the scheduled publisher. It validates complete runs
before publishing. Manual submit does not submit a dependent publisher job.

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
