# Weather Map Infrastructure

Project-specific infrastructure for Weather Map.

## Layout

- `weather-etl`: production weather ETL stack for GFS and ICON.
- `site`: static site and CloudFront infrastructure for
  `weather.zmbm.dev`.
- `../config/`: production ETL/catalog config uploaded by the weather-etl stack.
- `../scripts`: build, upload, fetch, and manual ETL helpers.

Shared account foundations such as DNS, certificates, network, and reusable
Terraform modules live in the sibling shared infra repo.

## Weather ETL

Deploy the weather ETL stack:

```bash
scripts/etl-deploy.sh
```

Preview without applying:

```bash
scripts/etl-deploy.sh --plan-only
```

Upload static PMTiles assets from `artifacts/pmtiles/`:

```bash
scripts/etl-deploy.sh --upload-static
```

Manual production cycle submits:

```bash
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id gfs
scripts/etl-run-aws.sh --cycle YYYYMMDDHH --dataset-id icon
```

Manual submits snapshot the Terraform-deployed pipeline/catalog config before
Batch workers start. The scheduled publisher validates complete runs, publishes
manifests, refreshes `manifests/index.json`, and updates root `status.json`.

See [weather-etl/README.md](weather-etl/README.md) for production ETL details.
