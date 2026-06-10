# Weather Map Infrastructure

This directory contains infrastructure owned by the weather-map project.

## Layout

- `weather-etl`: production weather ETL stack for GFS and ICON.
- `site`: static site and CloudFront infrastructure for
  `weather.zmbm.dev`.
- `../config/pipeline.json`: production ETL runtime config uploaded by
  the weather-etl stack.
- `../scripts`: production build, upload, smoke, and manual ETL job helpers.

Shared account foundations such as DNS, certificates, network, and reusable
Terraform modules stay in the sibling shared infra repo.

## Weather ETL

Build the shared ingest Lambda zip before applying Lambda changes:

```bash
scripts/etl-build-lambda.sh
```

Push the Batch worker image after code or dependency changes in `etl/`:

```bash
scripts/etl-build-worker-image.sh
```

Upload static artifact assets from `artifacts/glyphs/`, `artifacts/pmtiles/`,
and `artifacts/radio/`:

```bash
scripts/etl-upload-static-artifacts.sh
```

Manual production cycle submits:

```bash
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id gfs
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id icon
```

Manual submits use the Terraform-deployed pipeline config and catalog
to create a run-scoped snapshot before Batch workers start. The scheduled
publisher validates complete runs and publishes only runs with a passing
`validation.json`. Publishing writes immutable public run manifests, updates
full-manifest `current.json`/`latest.json` aliases, and refreshes
`manifests/index.json` when the latest published cycle changes. The scheduled
publisher also refreshes root `status.json`, which is the backend/API health
contract.

See [weather-etl/README.md](weather-etl/README.md) for the
GFS/ICON production architecture and operational details.
