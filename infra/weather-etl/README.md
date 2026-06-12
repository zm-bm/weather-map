# Weather ETL Stack

Production weather ETL infrastructure for GFS, ICON, and MRMS.

## Flow

GFS is event-driven:

1. NOAA publishes a GFS object notification to SNS.
2. `weather-etl-ingest-gfs` filters the object key shape and synoptic cycle.
3. The Lambda gets or creates one run id for the accepted dataset cycle in the
   run coordinator table.
4. The Lambda creates or reads that run's config/catalog snapshot, filters the
   frame against the snapshot workload, and submits one Batch
   `run-frame` job with the shared `RUN_ID` and pinned snapshot URIs.
5. The worker reads the NOAA S3 object and writes field artifacts plus success
   markers.

ICON is polled:

1. EventBridge invokes `weather-etl-ingest-icon` every 10 minutes.
2. The Lambda checks only the latest `00/06/12/18 UTC` DWD ICON cycle
   (`ICON_POLL_CYCLE_COUNT=1`).
3. It waits for sentinel `f000` files, verifies required files for each
   configured frame, and uses the shared frame claim table to avoid duplicate
   submissions.
4. The Lambda gets or creates one run id for the dataset cycle, creates or reads
   that run's config/catalog snapshot, and uses that snapshot for readiness and
   completion checks before submitting frame jobs.
5. Batch workers download ICON files from DWD, decompress, regrid with direct
   CDO, and write field artifacts plus success markers.

MRMS is event-driven through SQS:

1. NOAA publishes an MRMS object notification to SNS.
2. SNS delivers the message to the MRMS ingest SQS queue with a DLQ.
3. `weather-etl-ingest-mrms` filters the object key to the two configured
   CONUS reflectivity products.
4. For each product object, the Lambda waits until the counterpart product
   exists for the same timestamp, creates a deterministic single-frame run id,
   writes the run snapshot, and submits one Batch `run-frame` job.
5. The worker reads both MRMS GRIB2 objects from `s3://noaa-mrms-pds/CONUS`
   and writes observed radar field artifacts plus success markers.

Publication is scheduled separately:

1. EventBridge invokes `weather-etl-publisher` every 10 minutes.
2. The publisher checks recent synoptic cycles for forecast datasets and recent
   hourly cycles for MRMS.
3. Complete runs are validated into run-scoped `validation.json` reports when
   needed.
4. Runs with passing validation publish immutable public run manifests, update
   full-manifest `current.json`/`latest.json` aliases, write the run-scoped
   `publication.json`, and rebuild the aggregate frontend manifest index when
   latest changes.

All datasets use the same worker image. Each run uses pinned copies of the
pipeline config and catalog stored under its run prefix.

New ETL output is grouped by run:

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

Public aliases remain under `manifests/`. Public payload serving is run-first
only through `/runs/*/payloads/*`; old type-first payload paths are no longer
exposed.

Public manifests use:

```text
manifests/<dataset_id>/cycles/<cycle>/runs/<run_id>.json
manifests/<dataset_id>/cycles/<cycle>/current.json
manifests/<dataset_id>/latest.json
manifests/index.json
```

Direct reads of `manifests/<dataset_id>/latest.json` and
`manifests/<dataset_id>/cycles/<cycle>/current.json` return full
`weather-map.dataset-cycle-manifest` objects. The frontend hot path continues
to read only `manifests/index.json`.

Automatic GFS and ICON ingest share a small DynamoDB run coordinator table:

```text
pk = <dataset_id>#<cycle>
run_id = YYYYMMDDTHHMMSSZ-<8hex>
ttl = 14 days by default
```

The table is intentionally only a run-id coordinator, not full orchestration
state. It prevents individual GFS SNS events or ICON poll submissions for the
same cycle from fragmenting into separate run ids.

Automatic GFS, automatic ICON, and manual AWS submits also share a small
DynamoDB frame claim table:

```text
pk = <dataset_id>#<cycle>#<run_id>#<frame_id>
state = claimed | complete
ttl = 14 days by default
```

Frame claims throttle duplicate submissions only. Success markers and
validation reports remain the source of truth for completeness and publication.
Expired claims allow retries, and explicit `--run-id` manual submits can resume
an existing run by submitting only frames that are not complete or actively
claimed.

## Source Data

- GFS: `s3://noaa-gfs-bdp-pds`
  - https://registry.opendata.aws/noaa-gfs-bdp-pds/
  - https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- ICON global: DWD Open Data
  - https://opendata.dwd.de/weather/nwp/icon/grib/
- MRMS CONUS: `s3://noaa-mrms-pds/CONUS`
  - https://registry.opendata.aws/noaa-mrms-pds/

## Config

Terraform uploads the production ETL config and catalog. Ingest
Lambdas and manual submit tooling use these deployed objects as the source of
truth when creating a run snapshot:

```text
PIPELINE_URI=s3://<config-bucket>/weather-etl/pipeline.json
CATALOG_URI=s3://<config-bucket>/weather-etl/catalog.json
```

Frames and produced artifact ids come from `datasets.<dataset_id>.workload` in
that config. Changes to `config/pipeline.json` or
`config/catalog.json` are deployed through this stack so the S3 source
objects are updated.

## Terraform Runtime Contract

This stack is intentionally organized around the ETL runtime contract:

```text
artifact_root_uri
pipeline_uri
catalog_uri
run_coordinator_table
frame_claim_table
Batch queue and job definitions
ingest and publisher Lambda names
ingest and publisher schedules
operational alerts and alert topic
```

The existing raw outputs used by the operator scripts remain stable. The stack
also exposes `etl_runtime_contract`, a grouped output intended for future
planner/executor work.

Operational knobs such as `environment`, `name_prefix`, worker image tag,
Batch retries, Lambda timeouts, schedules, scan counts, and retention windows
are Terraform variables with production defaults. `observability_alert_email`
is required so production alarms have an explicit notification destination.
GFS ingest, ICON ingest, and the scheduled publisher all use the same Lambda
zip artifact.

The artifact and config buckets are treated as greenfield ETL resources:
`force_destroy` is enabled and `prevent_destroy` is not used. Do not rely on
this stack to protect old run artifacts during a clean redeploy.

## Deploy

Production deploys should be coordinated across the worker image, Lambda zip,
and Terraform. New workers require `RUN_ID`, and the ingest Lambdas/Terraform
provide the run coordinator table, frame claim table, and container overrides.
Local ETL reruns are fine for validating intermediate task work; bundle related
ETL hardening tasks into one production deploy when that is less operationally
painful.

From the repo root, build the shared Lambda artifact before deploying Lambda
code changes:

```bash
scripts/etl-build-lambda.sh
```

From the repo root, push the worker image after ETL code or dependency changes:

```bash
scripts/etl-build-worker-image.sh
```

The Lambda artifact is shared by the ingest and publisher Lambdas:

```text
etl/dist/weather-etl-ingest-lambda.zip
```

The worker image contains GDAL, CDO, eccodes tools, and ICON regrid assets.

After building the Lambda zip and pushing the worker image, apply this stack so
the ingest/publisher Lambdas, EventBridge rules, IAM, config/catalog objects,
Batch job definitions, run coordinator table, and frame claim table are all
current:

```bash
cd infra/weather-etl
cp terraform.tfvars.example local.auto.tfvars
# edit local.auto.tfvars
terraform plan
terraform apply
```

## Operations

From the repo root, manually submit a production cycle:

```bash
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id gfs
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id icon
```

MRMS production ingest is normally driven by the SNS/SQS notification path so
the Lambda can create a timestamp-pinned single-frame run snapshot.

Manual submits generate one run id per submitted cycle unless `--run-id` or
`RUN_ID` is supplied. Supplying `--run-id` resumes that existing run and skips
complete or actively claimed frames. Before submitting workers, the script
creates a run snapshot from the deployed Terraform-managed config/catalog,
plans frame state, acquires frame claims, and passes run snapshot URIs to every
Batch job. Use `--dry-run` to verify the run id, snapshot URIs, and
submit/skip decisions before touching Batch:

```bash
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id gfs --dry-run
```

Publication is handled by the scheduled publisher. It validates complete runs
before publishing. Manual submit does not submit a dependent publisher job.

## Observability

The stack creates low-noise AWS operational alerts through CloudWatch alarms,
EventBridge Batch events, and an email-backed SNS topic. The email subscription
must be confirmed from the AWS SNS confirmation email before alarm notifications
are delivered.

The scheduled publisher refreshes the published root `status.json` document on
each run. Health consumers should read that document instead of CloudWatch
custom ETL metrics.

Alerts are configured for:

- GFS ingest, ICON ingest, and publisher Lambda errors
- MRMS ingest Lambda errors
- Batch worker `FAILED` state-change events
- Batch queue blocked events

Normal in-progress cycles and publisher `not_ready` candidates stay quiet.
Successful cycles do not send success notifications.

Enable or disable ICON polling:

```bash
aws events enable-rule --name weather-etl-ingest-icon-poll
aws events disable-rule --name weather-etl-ingest-icon-poll
```

Useful live logs:

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
