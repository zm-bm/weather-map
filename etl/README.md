# Weather ETL

This package builds forecast artifacts for Weather Map. It has the Python ETL
code, the Docker worker image, and the AWS Batch worker submission path for GFS,
ICON, and observed datasets.

For most work, start with the scripts:

- `scripts/etl-run-aws.sh` submits AWS Batch frame workers for a cycle.
- `scripts/etl-sync-artifacts.py` copies the latest or selected published run
  artifacts into the local `artifacts/` tree.

The Python CLI is mostly for worker and submit plumbing.

## Quick Start

Bootstrap the shared Python env:

```bash
scripts/bootstrap.sh
```

Submit AWS Batch frame workers:

```bash
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH> --dry-run
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH>
```

Fetch latest published artifacts for local dev:

```bash
scripts/etl-sync-artifacts.py \
  --artifact-root-uri s3://<artifact-bucket-or-prefix>
```

Fetch a specific published run:

```bash
scripts/etl-sync-artifacts.py \
  --artifact-root-uri s3://<artifact-bucket-or-prefix> \
  --dataset-id gfs \
  --cycle <YYYYMMDDHH> \
  --run-id <run_id>
```

The fetch script keeps the local manifest index limited to downloaded datasets,
so the frontend does not request missing local payloads.

## AWS Submission

Manual AWS submission creates or resumes a run, snapshots deployed config,
plans frame workers, skips complete or actively claimed frames, and submits the
rest to Batch.

```bash
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH> --dry-run
scripts/etl-run-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH>
```

Submission does not publish inline. The scheduled `weather-etl-publisher`
Lambda validates complete runs, publishes manifests, updates
`manifests/index.json`, and refreshes root `status.json`.

See `infra/weather-etl/README.md` for production deploy and AWS details.

## CLI

Installed CLI commands used by workers and manual submits:

```bash
.venv/bin/weather-etl run-frame \
  --dataset-id <dataset_id> \
  --cycle <YYYYMMDDHH> \
  --run-id <run_id> \
  --frame-id <FFF>

.venv/bin/weather-etl submit-aws-run \
  --dataset-id <dataset_id> \
  --cycle <YYYYMMDDHH> \
  --job-queue <name> \
  --job-definition <arn> \
  --frame-claim-table <table>
```

## Config

Forecast product config lives at the repo root:

- `config/pipeline.json`: what the ETL can produce.
- `config/catalog.json`: what the product/frontend exposes.

Every run snapshots both files before frame workers start, so the run stays
pinned to the config it was planned with.

For the config model and ETL terms, see `../config/README.md`.

## Artifacts and Health

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

`status.json` is the public ETL health document. The backend reads it for
`/api/health`.

## Code Map

Where to look:

- `adapters/`: CLI and AWS Lambda entrypoint adapters.
- `operations/`: ETL use cases: run planning, frame work, validation,
  publication, source submission, and status refresh.
- `workers/`: frame worker specs, worker plans, frame claims, and AWS Batch
  launch mechanics.
- `state/`: durable artifact, run, manifest, and inspection/status-document
  state.
- `config/`: static product config models for `pipeline.json` and
  `catalog.json`.
- `sources/`: GFS/ICON acquisition and readiness logic.
- `processing/`: transform code that runs inside frame workers.
- `storage/`: URI and object-store I/O helpers.

## Checks

```bash
cd etl && ../.venv/bin/python -m pytest tests
cd etl && ../.venv/bin/ruff check weather_etl tests
python3 -m py_compile scripts/etl-sync-artifacts.py
bash -n scripts/etl-run-aws.sh
bash -n scripts/etl-deploy.sh
```
