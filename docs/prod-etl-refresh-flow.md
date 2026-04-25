# Production ETL Refresh Flow

This documents how forecast artifacts are produced for production and the
intended static delivery shape for the app and artifact paths.

Infra still lives in `/home/rick/code/infra`.

## Scope

There are two connected flows in production:

1. Artifact production (NOAA event -> Lambda -> Batch ETL -> S3 artifacts)
2. Static delivery from S3 + CloudFront on one public origin

## 1) Artifact production flow (infra `stacks/weather-etl`)

### Trigger

1. NOAA publishes new GFS objects and emits SNS notifications.
2. Terraform subscribes Lambda `weather-etl-ingest-gfs` to the NOAA SNS topic.
3. Lambda parses the SNS payload and extracts S3 object references.

Key infra:

- `stacks/weather-etl/lambda.tf`
- `stacks/weather-etl/variables.tf` (`gfs_sns_topic_arn`)
- canonical handler source in `weather-map/etl/gfs_pipeline/aws/ingest.py`

### Filtering and fanout

Lambda accepts only keys matching:

- `gfs.<YYYYMMDD>/<HH>/atmos/gfs.tHHz.pgrb2.0p25.fFFF`

Then it filters by:

- allowed cycle hours: `00, 06, 12, 18` (hardcoded)
- allowed forecast hours: from pipeline config `workload.forecast_hours`
- scalar variables: from pipeline config `workload.variables`
- vector variables: from pipeline config `vector_variables`

Canonical pipeline config lives in:

- `weather-map/etl/gfs.etl_config.json`

The currently deployed infra stack still wires its own Terraform-managed copy until the infra handoff is updated.

### Batch submission

For each accepted `(cycle, fhour)` GRIB, Lambda submits one AWS Batch job with env:

- `CYCLE`
- `FHOUR`
- `GRIB_SOURCE_URI=s3://<bucket>/<key>`

Terraform creates:

- Fargate Spot compute environment (`weather-etl-fargate-spot`)
- queue (`weather-etl`)
- job definition (`weather-etl-worker`)

The worker container image is:

- `<gfs-worker ECR repo>:latest`

Default job env includes:

- `ARTIFACT_ROOT_URI=s3://<artifacts_bucket>`
- `PIPELINE_CONFIG_URI=file:///app/gfs.etl_config.json`

Key infra:

- `stacks/weather-etl/batch-runtime.tf`
- `stacks/weather-etl/main.tf` (ECR repo `gfs-worker`)
- `stacks/weather-etl/outputs.tf`

### What runs inside each Batch job

The ETL image now runs the Python CLI directly:

- entrypoint: `python -u -m gfs_pipeline.cli`
- default command: `run-hour`

`run-hour` resolves `CYCLE`, `FHOUR`, and `GRIB_SOURCE_URI` from env when flags
are omitted, materializes the source URI through the URI store, runs the hour,
and publishes by default.

Because publish is success-marker based and idempotent, running it on every job
is safe.

Outputs are written to the artifacts bucket under:

- `fields/<cycle>/<fhour>/<layer>.scalar.i16.bin`
- `fields/<cycle>/<fhour>/<layer>.vector.i8.bin`
- `status/<cycle>/<layer>/<fhour>._SUCCESS.json`
- `manifests/<cycle>.json`
- `manifests/latest.json`
- `status/<cycle>/_PUBLISHED.json`

## 2) Static delivery path

The repo no longer carries the old EC2/nginx/Martin serving path.

The intended production shape is:

- frontend static build in S3
- artifact prefixes in S3:
  - `manifests/*`
  - `fields/*`
  - `pmtiles/*`
  - `radio/*`
- CloudFront in front of those S3 origins with one public origin surface

That keeps the frontend request model aligned with local development:

- `/manifests/*` for manifests
- `/fields/*` for forecast payloads
- `/pmtiles/*` for optional basemap archives
- `/radio/*` for audio assets
- frontend-owned glyph/font assets served from the frontend build itself

The frontend runtime already assumes that same-origin path layout. The remaining
handoff work is in the infra repo: update S3/CloudFront routing and deployment
to match this static serving model.

## Operational notes

### Config consistency (important)

Canonical ETL application sources now live in `weather-map`:

- ingest handler: `etl/gfs_pipeline/aws/ingest.py`
- batch runtime CLI: `etl/gfs_pipeline/cli.py`
- pipeline config: `etl/gfs.etl_config.json`
- operator helpers: `etl/scripts/aws/*`

Terraform still lives in `/home/rick/code/infra/stacks/weather-etl` for now, so infra wiring can temporarily lag the canonical application sources until the next handoff step.

### Artifacts bucket selection

`stacks/weather-etl` defaults `use_dev_artifacts_bucket=true`.

That means ETL may write to `gfs-artifacts-dev-*` unless explicitly set to false.

For real production refresh, make sure ETL writes to the same artifacts bucket
that CloudFront/S3 production delivery reads from.

### Manual testing helpers

- `weather-map/etl/scripts/aws/submit-smoke.sh` submits a smoke Batch job by overriding the container command to `smoke`.
- `weather-map/etl/scripts/aws/submit-worker-job.sh` submits a run-hour job with explicit `CYCLE/FHOUR/GRIB_SOURCE_URI`.
- `weather-map/etl/scripts/aws/invoke-lambda-test.sh` invokes the existing Lambda against a repo-local SNS fixture.
