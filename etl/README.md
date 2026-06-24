# Weather ETL

This package builds forecast artifacts for Weather Map. It owns the Python ETL
code, the Docker worker image, and the AWS Batch worker submission path for GFS,
ICON, and observed datasets.

For normal work, start with the shell wrappers:

- `scripts/etl-run-aws.sh` submits AWS Batch frame workers for a cycle.
- `scripts/etl-sync-artifacts.sh` copies the latest or selected published run
  artifacts into the local `artifacts/` tree.

The Python CLI intentionally keeps a narrow operational surface: submit a run
or run one frame worker.

## Quick Start

Set up the shared Python environment:

```bash
scripts/bootstrap.sh
```

Submit AWS Batch frame workers for one dataset:

```bash
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH> --dry-run
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH>
```

Fetch the latest published GFS artifacts for local development:

```bash
scripts/etl-sync-artifacts.sh \
  --artifact-root-uri s3://<artifact-bucket-or-prefix>
```

Fetch a specific published run:

```bash
scripts/etl-sync-artifacts.sh \
  --artifact-root-uri s3://<artifact-bucket-or-prefix> \
  --dataset-id gfs \
  --cycle <YYYYMMDDHH> \
  --run-id <run_id>
```

The fetch script keeps the local manifest index limited to the datasets it
downloaded, so the frontend does not request missing local payloads.

## AWS Submission

Manual AWS submission creates or resumes a run, snapshots the deployed product
config, plans frame workers, skips complete or actively claimed frames, and
submits the remaining workers to Batch.

```bash
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH> --dry-run
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH>
```

Submission does not validate or publish inline. In production, the scheduled
`weather-etl-publisher` Lambda validates complete runs, publishes manifests,
updates `manifests/index.json`, and refreshes root `status.json`.

Use `infra/weather-etl/README.md` for deeper production deploy and
AWS operator details.

## CLI

The installed CLI exposes only the operational commands needed by the worker and
manual submission paths:

```bash
.venv/bin/weather-etl run-frame --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id> --frame-id <FFF>
.venv/bin/weather-etl submit-aws-run --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --job-queue <name> --job-definition <arn> --frame-claim-table <table>
```

## Config

Forecast product config lives at the repo root:

- `config/pipeline.json`: what the ETL can produce.
- `config/catalog.json`: what the product/frontend exposes.

The ETL snapshots both files into every run before frame workers start. That
keeps a run pinned to the config it was planned with, even if the repo or
deployed config changes later.

For the config model and the current product support table, see
`../docs/forecast-config.md`.

## Artifacts And Health

A run writes durable state under `runs/<dataset_id>/<cycle>/<run_id>/`:

```text
run.json
config/pipeline.json
config/catalog.json
payloads/<frame_id>/<artifact>.<dtype>.bin
status/<artifact>/<frame_id>._SUCCESS.json
validation.json
manifest.json
publication.json
```

Published public state lives at the artifact root:

```text
manifests/<dataset_id>/cycles/<cycle>/runs/<run_id>.json
manifests/<dataset_id>/cycles/<cycle>/current.json
manifests/<dataset_id>/latest.json
manifests/index.json
status.json
```

`status.json` is the public ETL health document. The backend reads it to serve
`/api/health`; backend/API code should not inspect ETL internals directly.

## Code Map

The package is organized around a few stable boundaries:

- `adapters/`: CLI and AWS Lambda entrypoint adapters.
- `operations/`: ETL use cases: run planning, frame work, validation,
  publication, source submission, and status refresh.
- `workers/`: frame worker specs, worker plans, frame claims, and AWS Batch
  launch mechanics.
- `state/`: durable artifact, run, manifest, and inspection/status-document
  state.
- `config/`: static product config contracts for `pipeline.json` and
  `catalog.json`.
- `sources/`: GFS/ICON acquisition and readiness logic.
- `processing/`: transform code that runs inside frame workers.
- `storage/`: URI and object-store I/O helpers.

## Checks

```bash
cd etl && ../.venv/bin/python -m pytest tests
cd etl && ../.venv/bin/ruff check weather_etl tests
bash -n scripts/etl-sync-artifacts.sh
bash -n scripts/etl-run-aws.sh
bash -n scripts/etl-deploy.sh
```
