# Weather ETL infrastructure

This stack runs the shared forecast ETL platform plus the GFS SNS ingest
trigger.

Core idea:

- Subscribe a Lambda to NOAA GFS SNS notifications.
- Filter incoming object events to only files this pipeline should process.
- Submit AWS Batch jobs that run worker + publish logic from the ETL container.

## Source data

Data source details are documented here:

- https://registry.opendata.aws/noaa-gfs-bdp-pds/

That source publishes SNS notifications for new objects. The pipeline subscribes a Lambda to that topic and decides which objects to process.

The contents of the GFS files and their naming conventions are documented here:

- https://www.nco.ncep.noaa.gov/pmb/products/gfs/
- https://www.nco.ncep.noaa.gov/pmb/products/gfs/gfs.t00z.pgrb2.0p25.f000.shtml

## High-level flow

1. NOAA publishes a new GFS object and emits an SNS notification.
2. SNS invokes an ingest Lambda in this account.
3. Lambda parses the message and applies filters (forecast hour, suffix, path pattern, etc.).
4. If accepted, Lambda submits an AWS Batch job.
5. Batch container runs `forecast-etl run-hour`.
6. `run-hour` processes the accepted `(cycle, fhour)` and publishes the cycle when all expected raster + wind outputs are present.

## Resource layout

This stack is project-owned by `weather-map` and currently declares its AWS
resources directly. Shared account foundations, such as the network remote
state, remain in the sibling shared infra repo.

### 1) S3

- `weather-etl-artifacts-prod-<account>`
  - Stores MBTiles, status/success markers, and manifests.
- `weather-etl-config-prod-<account>`
  - Stores shared ETL pipeline config read by Lambda and Batch.

### 2) SNS subscription + Lambda

- Subscribe Lambda to NOAA SNS topic.
- Lambda responsibilities:
  - Decode SNS payload.
  - Extract object key and metadata.
  - Apply allow/deny filters.
  - Derive `cycle`, `fhour`, and source URI.
  - Submit Batch job only when event matches processing rules.

### 3) AWS Batch

- Managed compute environment (Spot, scale-to-zero).
- Job queue + job definition for ETL worker container image.
- Each submitted job should include cycle/fhour/source URI inputs.

The compute environment uses Fargate Spot and a bounded `max_vcpus` so it can
scale down when no jobs are running.

### 4) ECR

- Repository for ETL container built from weather-map/etl.
- `weather-etl-worker`

### 5) State / idempotency (optional but recommended)

Use DynamoDB for dedupe and observability, for example:

- processed event ids (SNS message id or object key + etag)
- job submission ledger
- optional per-cycle counters

Note: publish marker files in artifacts already provide cycle completion idempotency.

## Batch job command pattern

The container default command is `run-hour`. Each accepted event provides
`CYCLE`, `FHOUR`, and `GRIB_SOURCE_URI` through Batch environment overrides.

`run-hour` publishes by default. Publishing is idempotent and success-marker
based, so running it at the end of every job is acceptable.

## Filtering guidance (important)

Keep Lambda filtering strict to avoid wasted compute:

- Accept only GFS paths you actually process.
- Accept only desired forecast hours.
- Accept only supported file suffixes.
- Optionally gate by cycle cadence.

Treat unknown key formats as no-op with structured logs.

## Config-driven Lambda filters

Lambda can use the same pipeline config JSON as Batch to decide:

- allowed `forecast_hours`
- configured `workload.products`

### How it works

- Terraform uploads `infra/config/forecast.etl_config.json` to the config bucket.
- Lambda and Batch both receive the same `PIPELINE_CONFIG_URI = s3://...` value from Terraform.
- Lambda hardcodes allowed cycles to `00,06,12,18` and uses `workload.forecast_hours` from that shared config for filtering.
- Lambda submits one job per accepted GRIB key; `run-hour` uses the same shared config to process all raster layers and all wind artifacts.

Canonical Lambda application code is built into a zip artifact by this repo's
`etl` package. This stack owns deployment and consumes that artifact via
`var.ingest_lambda_zip_path`.

Before running `terraform plan` or `terraform apply` for this stack, build or
refresh that artifact from the weather-map repo root:

- `infra/scripts/weather-etl/release/build-ingest-lambda-zip.sh`

Operator scripts live in `infra/scripts/weather-etl/ops` and run Terraform
output commands against this stack internally.

## IAM baseline

### Lambda role

- `batch:SubmitJob`
- read access to config/state (if used)
- CloudWatch Logs write

### Batch job role

- read source GRIB objects
- write artifacts bucket outputs and status markers
- CloudWatch Logs write

Scope policies to exact buckets/prefixes where possible.

## Reliability and operations

Recommended minimum controls:

- Lambda DLQ (or on-failure destination).
- Batch retry strategy.
- CloudWatch alarms on Lambda errors and Batch failures.
- Structured logs with cycle/fhour fields.

## Notes / deferred decisions

- Exact key filter rules for accepted GFS objects.
- Whether to use DynamoDB dedupe now or rely on idempotent publish first.
- Capacity tuning (instance families, vCPU caps, retries).
