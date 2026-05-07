# Weather Map infrastructure

This directory contains infrastructure that is owned by the weather-map
project.

## Layout

- `terraform/weather-etl`: project-owned AWS Batch, Lambda, ECR, and S3
  resources for the forecast ETL.
- `terraform/static-site`: project-owned static site and CloudFront
  infrastructure. This has not been migrated from the shared infra repo yet.
- `config/forecast.etl_config.json`: prod runtime config uploaded by the weather
  ETL Terraform stack.
- `scripts/weather-etl/release`: production build and publish helpers for the
  weather ETL Lambda and Batch worker image. A `deploy.sh` entrypoint can be
  added here later when the release flow is ready to apply Terraform.
- `scripts/weather-etl/ops`: production smoke, manual Batch, and Lambda
  invocation helpers.

Shared account foundations and reusable modules stay in the sibling shared
infra repo:

- account foundations: DNS, certificates, network, GitHub OIDC, shared edge
- reusable modules: S3 bucket, static site, and similar building blocks

Terraform stacks that need shared modules should reference them through Git
module sources pinned to release tags.

## Weather ETL

Production flow:

1. NOAA publishes a GFS object notification.
2. SNS invokes the ingest Lambda.
3. Lambda filters the S3 key using the configured workload from
   `infra/config/forecast.etl_config.json`.
4. Lambda submits an AWS Batch `run-hour` job for accepted objects.
5. Batch writes field payloads, success markers, and manifests to S3.

### Update Infra

Run weather ETL Terraform from its stack directory:

```bash
cd infra/terraform/weather-etl
AWS_PROFILE=admin AWS_SDK_LOAD_CONFIG=1 terraform init
AWS_PROFILE=admin AWS_SDK_LOAD_CONFIG=1 terraform plan -no-color
AWS_PROFILE=admin AWS_SDK_LOAD_CONFIG=1 terraform apply
```

Before planning or applying Lambda changes, build the Lambda artifact from the
repo root:

```bash
infra/scripts/weather-etl/release/build-ingest-lambda-zip.sh
```

Terraform uploads the prod pipeline config from:

```text
infra/config/forecast.etl_config.json
```

If that config changes, run the Terraform plan/apply flow above so the config
bucket receives the updated object.

### Release Worker Image

The ECR repository is Terraform-managed as `weather-etl-worker`. On a fresh
deploy, apply Terraform once before pushing the worker image so the repository
exists.

First-deploy order:

1. Build the Lambda artifact.
2. Apply Terraform.
3. Build and push the worker image.

Build and push the Batch worker image:

```bash
infra/scripts/weather-etl/release/build-push-worker-image.sh
```

The script defaults `IMAGE_TAG` to the current Git short SHA and also pushes
`latest`.

### Operate Prod ETL

Production smoke and manual Batch helpers live under:

```text
infra/scripts/weather-etl/ops/
```

Useful commands:

```bash
infra/scripts/weather-etl/ops/submit-smoke.sh
infra/scripts/weather-etl/ops/submit-cycle.sh --cycle YYYYMMDDHH --model gfs
```

## Transition notes

After this migration, run weather ETL Terraform commands from
`terraform/weather-etl`. The previous `stacks/weather-etl` copy should be
removed from the shared infra repo after this project-owned stack is committed
and accepted as the source of truth.
