# Weather ETL Stack

Production ETL infrastructure for GFS, ICON, and MRMS.

## Ingest Flow

GFS is event-driven:

1. NOAA publishes a GFS object notification to SNS.
2. `weather-etl-ingest-gfs` filters the key and synoptic cycle.
3. The Lambda creates or reuses one run id for that dataset/cycle.
4. It snapshots the deployed pipeline/catalog config and submits one Batch
   `run-frame` job for the accepted frame.
5. The worker reads the NOAA object and writes artifacts plus success markers.

ICON is polled:

1. EventBridge invokes `weather-etl-ingest-icon` every 10 minutes.
2. The Lambda checks the latest `00/06/12/18 UTC` DWD ICON cycle.
3. It waits for sentinel `f000` files and uses frame claims to avoid duplicate
   submissions.
4. Batch workers download, decompress, regrid, and write artifacts plus success
   markers.

MRMS is event-driven through SQS:

1. NOAA publishes MRMS object notifications to SNS.
2. SNS sends them to the MRMS ingest queue with a DLQ.
3. `weather-etl-ingest-mrms` waits until both configured CONUS reflectivity
   products exist for the same timestamp.
4. The Lambda creates a deterministic single-frame run and submits one Batch
   `run-frame` job.

Publication is separate. `weather-etl-publisher` runs every 10 minutes,
validates complete runs, publishes manifests, refreshes `manifests/index.json`,
and writes root `status.json`.

All datasets use the same worker image. Each run uses pinned copies of
`pipeline.json` and `catalog.json` stored under the run prefix.

## Layout

Run-scoped state:

```text
runs/<dataset_id>/<cycle>/<run_id>/
  run.json
  config/pipeline.json
  config/catalog.json
  payloads/<frame_id>/<artifact>.<dtype>.bin
  status/<artifact>/<frame_id>._SUCCESS.json
  validation.json
  manifest.json
  publication.json
```

Public manifests:

```text
manifests/<dataset_id>/cycles/<cycle>/runs/<run_id>.json
manifests/<dataset_id>/cycles/<cycle>/current.json
manifests/<dataset_id>/latest.json
manifests/index.json
```

Public payload serving is run-first only through `/runs/*/payloads/*`.

Two small DynamoDB tables coordinate automatic ingest:

- run coordinator: one run id per `dataset_id#cycle`
- frame claims: duplicate-submission throttle per
  `dataset_id#cycle#run_id#frame_id`

Success markers and validation reports decide what can publish.

## Source Data

- GFS: `s3://noaa-gfs-bdp-pds`
  - https://registry.opendata.aws/noaa-gfs-bdp-pds/
  - https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- ICON global: DWD Open Data
  - https://opendata.dwd.de/weather/nwp/icon/grib/
- MRMS CONUS: `s3://noaa-mrms-pds/CONUS`
  - https://registry.opendata.aws/noaa-mrms-pds/

## Config

Terraform uploads the production pipeline/catalog config:

```text
PIPELINE_URI=s3://<config-bucket>/weather-etl/pipeline.json
CATALOG_URI=s3://<config-bucket>/weather-etl/catalog.json
```

Ingest Lambdas and manual submit tooling snapshot those objects when creating
a run. Deploy changes to `config/pipeline.json` or `config/catalog.json`
through this stack.

For a new environment:

```bash
cd infra/weather-etl
cp terraform.tfvars.example local.auto.tfvars
# edit local.auto.tfvars
```

## Deploy

From the repo root:

```bash
scripts/etl-deploy.sh
```

Useful variants:

```bash
scripts/etl-deploy.sh --plan-only
scripts/etl-deploy.sh --auto-approve
scripts/etl-deploy.sh --upload-static
```

The deploy script builds the shared Lambda zip, builds/pushes the worker image,
runs Terraform, and uses the same worker image tag for the full stack.

## Operations

Manually submit a production cycle:

```bash
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id gfs
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id icon
```

Dry-run before touching Batch:

```bash
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id gfs --dry-run
```

Manual submits create one run id per cycle unless `--run-id` or `RUN_ID` is
supplied. Supplying a run id resumes that run and skips complete or actively
claimed frames.

MRMS production ingest normally comes from the SNS/SQS path so each timestamp
gets a pinned single-frame run.

Publication is handled by the scheduled publisher. Manual submit does not
submit a dependent publisher job.

## Observability

The stack creates CloudWatch/EventBridge alerts for:

- GFS ingest, ICON ingest, and publisher Lambda errors
- MRMS ingest Lambda errors
- Batch worker `FAILED` state changes
- Batch queue blocked events

Confirm the SNS email subscription before expecting notifications.
Normal in-progress cycles and publisher `not_ready` candidates stay quiet.

Enable or disable ICON polling:

```bash
aws events enable-rule --name weather-etl-ingest-icon-poll
aws events disable-rule --name weather-etl-ingest-icon-poll
```

Useful logs:

```bash
aws logs tail /aws/lambda/weather-etl-ingest-icon --since 2h --follow
aws logs tail /aws/lambda/weather-etl-ingest-mrms --since 2h --follow
aws logs tail /aws/batch/weather-etl --since 2h --follow
```

Batch queue spot check:

```bash
aws batch list-jobs --job-queue weather-etl --job-status RUNNING
aws batch list-jobs --job-queue weather-etl --job-status FAILED
```
