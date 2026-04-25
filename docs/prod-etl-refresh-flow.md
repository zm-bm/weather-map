# Production ETL Refresh Flow

This documents how scalar weather + wind artifacts are produced and refreshed in production using:

- `weather-map` repo runtime scripts/systemd units
- `infra` repo Terraform in `/home/rick/code/infra`

## Scope

There are two connected flows in production:

1. Artifact production (NOAA event -> Lambda -> Batch ETL -> S3 artifacts)
2. Tileserver refresh on EC2 (poll S3 -> copy latest cycle -> restart compose)

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

## 2) Legacy prod serving path

The repo no longer carries the old poll-and-sync tileserver refresh script.

What remains here:

- `deploy/compose.prod.yml`
- `deploy/systemd/weather-map-compose.service`
- nginx/Martin config under `deploy/` and `tileserver/`

What does not remain here anymore:

- `scripts/poll-tiles.sh`
- `deploy/systemd/weather-map-poll-tiles.service`
- `deploy/systemd/weather-map-poll-tiles.timer`
- `deploy/.env.example`

The infra repo may still have wiring that assumes those files exist. That handoff has not been updated yet.

### Current compose unit in this repo

`weather-map-compose.service` now just starts `deploy/compose.prod.yml` directly.

It no longer:

- reads `/etc/weather-map/poll-tiles.env`
- runs `ExecStartPre=/opt/weather-map/scripts/poll-tiles.sh`

That means production artifact delivery still needs a new design pass before the infra handoff is complete.

## Serving path in production

- `deploy/compose.prod.yml` runs Martin + nginx.
- Martin reads basemap/static tiles from `/data/static` and any configured tilesets.
- nginx serves:
  - `/manifests/*` from `/data/public/manifests/`
  - `/fields/*` from `/data/public/fields/`
- nginx proxies tile/font requests to Martin.

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
Tileserver instances in `stacks/weather-map` are configured to read `gfs-artifacts-prod-*`.

For real production refresh, make sure ETL writes to the same artifacts bucket the tiles instances poll.

### Manual testing helpers

- `weather-map/etl/scripts/aws/submit-smoke.sh` submits a smoke Batch job by overriding the container command to `smoke`.
- `weather-map/etl/scripts/aws/submit-worker-job.sh` submits a run-hour job with explicit `CYCLE/FHOUR/GRIB_SOURCE_URI`.
- `weather-map/etl/scripts/aws/invoke-lambda-test.sh` invokes the existing Lambda against a repo-local SNS fixture.
