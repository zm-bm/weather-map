# Weather Map Infrastructure

This directory contains infrastructure owned by the weather-map project.

## Layout

- `terraform/weather-etl`: production weather ETL stack for GFS and ICON.
- `terraform/site`: static site and CloudFront infrastructure for
  `weather.zmbm.dev`.
- `../config/pipeline.json`: production ETL runtime config uploaded by
  the weather-etl stack.
- `scripts/weather-etl/release`: production build and upload helpers.
- `scripts/weather-etl/ops`: production smoke and manual ETL job helpers.

Shared account foundations such as DNS, certificates, network, and reusable
Terraform modules stay in the sibling shared infra repo.

## Weather ETL

Build the shared ingest Lambda zip before applying Lambda changes:

```bash
infra/scripts/weather-etl/release/build-ingest-lambda-zip.sh
```

Push the Batch worker image after code or dependency changes in `etl/`:

```bash
infra/scripts/weather-etl/release/build-push-worker-image.sh
```

Upload static artifact assets from `artifacts/glyphs/`, `artifacts/pmtiles/`,
and `artifacts/radio/`:

```bash
infra/scripts/weather-etl/release/upload-static-artifacts.sh
```

Manual production cycle submits:

```bash
etl/scripts/run-cycle-aws.sh --cycle YYYYMMDDHH --dataset-id gfs
etl/scripts/run-cycle-aws.sh --cycle YYYYMMDDHH --dataset-id icon
```

Manual submits use the Terraform-deployed pipeline config and catalog
to create a run-scoped snapshot before Batch workers start. The scheduled
publisher validates complete runs and publishes only runs with a passing
`validation.json`. Publishing writes immutable public run manifests, updates
full-manifest `current.json`/`latest.json` aliases, and refreshes
`manifests/index.json` when the latest published cycle changes. The scheduled
publisher also refreshes root `status.json`, which is the backend/API health
contract.

See [terraform/weather-etl/README.md](terraform/weather-etl/README.md) for the
GFS/ICON production architecture and operational details.
