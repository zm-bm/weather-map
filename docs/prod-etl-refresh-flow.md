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
- `stacks/weather-etl/lambda/ingest.py`

### Filtering and fanout

Lambda accepts only keys matching:

- `gfs.<YYYYMMDD>/<HH>/atmos/gfs.tHHz.pgrb2.0p25.fFFF`

Then it filters by:

- allowed cycle hours: `00, 06, 12, 18` (hardcoded)
- allowed forecast hours: from pipeline config `workload.forecast_hours`
- weather layers: from pipeline config `workload.layers`
- wind layers: from pipeline config `wind_artifacts`

Pipeline config for Lambda defaults to bundled file:

- `file:///var/task/pipeline_config.json` from `stacks/weather-etl/lambda/pipeline_config.json`

### Batch submission

For each accepted `(cycle, fhour, layer)`, Lambda submits one AWS Batch job with env:

- `CYCLE`
- `FHOUR`
- `LAYER`
- `GRIB_SOURCE_URI=s3://<bucket>/<key>`

Terraform creates:

- Fargate Spot compute environment (`weather-etl-fargate-spot`)
- queue (`weather-etl`)
- job definition (`weather-etl-worker`)

The worker container image is:

- `<gfs-worker ECR repo>:latest`

Default job env includes:

- `ARTIFACT_ROOT_URI=s3://<artifacts_bucket>`
- `PIPELINE_CONFIG_URI=file:///app/pipeline_config.json`

Key infra:

- `stacks/weather-etl/batch-runtime.tf`
- `stacks/weather-etl/main.tf` (ECR repo `gfs-worker`)
- `stacks/weather-etl/outputs.tf`

### What runs inside each Batch job

Container entrypoint is `etl/batch-run.sh` in `weather-map`:

1. Downloads GRIB from `GRIB_SOURCE_URI` to local temp file.
2. Runs ETL worker:
   - `python -m gfs_pipeline.cli process-hour ...`
3. Runs publish:
   - `python -m gfs_pipeline.cli publish --cycle ...`

Because publish is success-marker based and idempotent, running publish on every job is safe.

Outputs are written to the artifacts bucket under:

- `weather/<cycle>/<fhour>/<layer>.scalar.i16.bin`
- `weather/<cycle>/<fhour>/<layer>.vector.i8.bin`
- `status/<cycle>/<layer>/<fhour>._SUCCESS.json`
- `manifests/<cycle>.json`
- `manifests/latest.json`
- `status/<cycle>/_PUBLISHED.json`

## 2) Tileserver refresh flow (infra `stacks/weather-map` + weather-map systemd/scripts)

### Instance boot wiring

`weather-map` stack launch template injects user-data from:

- `infra/templates/tiles-sync-userdata.sh.tmpl`

That writes `/etc/weather-map/poll-tiles.env` with:

- `ARTIFACT_SOURCE=s3://<prod artifacts bucket>`
- `RESTART_ENABLED=true`
- `TILESERVER_DIR=/opt/weather-map/tileserver`

It also optionally enables/mounts the static volume for `/opt/weather-map/tileserver/static`.

Key infra:

- `stacks/weather-map/launch-template.tf`
- `stacks/weather-map/locals.tf`
- `templates/tiles-sync-userdata.sh.tmpl`

### AMI contents and systemd

Packer image setup (`infra/packer/weather-map`) copies from this repo:

- `compose.prod.yml`
- `scripts/poll-tiles.sh`
- systemd units in `deploy/systemd/*`
- `tileserver/martin.yaml`
- nginx prod config + fonts/sprites

It enables:

- `weather-map-compose.service`
- `weather-map-poll-tiles.timer`

### Runtime refresh behavior

On service start:

- `weather-map-compose.service` runs `ExecStartPre=/opt/weather-map/scripts/poll-tiles.sh`
- then brings up compose stack from `compose.prod.yml`

Every 5 minutes:

- `weather-map-poll-tiles.timer` triggers `weather-map-poll-tiles.service`
- which runs `/opt/weather-map/scripts/poll-tiles.sh`

`poll-tiles.sh` behavior:

1. Read `ARTIFACT_SOURCE` (`s3://...` in prod).
2. Compare upstream `manifests/latest.json` to local `public/manifests/latest.json`.
3. If changed:
   - copy cycle manifest (`<cycle>.json`) and latest pointer to `public/manifests/`
   - sync `weather/<cycle>/...` scalar + vector payloads to `public/weather/<cycle>/`
   - prune old-cycle weather artifacts and stale legacy manifest names (default)
4. If `RESTART_ENABLED=true`, run:
   - `systemctl restart weather-map-compose`

Key files in this repo:

- `scripts/poll-tiles.sh`
- `deploy/systemd/weather-map-compose.service`
- `deploy/systemd/weather-map-poll-tiles.service`
- `deploy/systemd/weather-map-poll-tiles.timer`

## Serving path in production

- `compose.prod.yml` runs Martin + nginx.
- Martin reads basemap/static tiles from `/data/static` and any configured tilesets.
- nginx serves:
  - `/manifests/*` from `/data/public/manifests/`
  - `/weather/*` from `/data/public/weather/`
- nginx proxies tile/font/sprite requests to Martin.

## Operational notes

### Config consistency (important)

There are two default pipeline config locations in this architecture:

1. Lambda bundled config (`/var/task/pipeline_config.json`) used for ingest filtering/fanout.
2. ETL image bundled config (`/app/pipeline_config.json`) used by Batch worker/publish.

If these diverge, Lambda may submit jobs with assumptions that do not match worker expectations. Keep them in sync, or move both to a shared `s3://...` config and pass `PIPELINE_CONFIG_URI`.

### Artifacts bucket selection

`stacks/weather-etl` defaults `use_dev_artifacts_bucket=true`.

That means ETL may write to `gfs-artifacts-dev-*` unless explicitly set to false.  
Tileserver instances in `stacks/weather-map` are configured to read `gfs-artifacts-prod-*`.

For real production refresh, make sure ETL writes to the same artifacts bucket the tiles instances poll.

### Manual testing helpers (infra repo)

- `stacks/weather-etl/submit-smoke.sh` submits a smoke Batch job (`SMOKE_TEST=true`).
- `stacks/weather-etl/submit-worker-job.sh` submits a process-hour job with explicit `CYCLE/FHOUR/GRIB_SOURCE_URI`.
