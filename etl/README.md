# Weather ETL

This package builds forecast artifacts for Weather Map. It owns the Python ETL
code, the Docker worker image, the local cycle runner, and the AWS Batch worker
submission path for GFS and ICON.

For normal work, start with the shell wrappers:

- `etl/scripts/run-cycle-local.sh` runs a complete local cycle with Docker
  frame workers.
- `etl/scripts/run-cycle-aws.sh` submits AWS Batch frame workers for a cycle.

The Python CLI does the real work behind those wrappers. Use it directly when
you are debugging a stage, inspecting persisted state, or writing tests.

## Quick Start

Set up the shared Python environment:

```bash
etl/scripts/bootstrap.sh
```

Run a local cycle for one dataset:

```bash
etl/scripts/run-cycle-local.sh --dataset-id gfs --cycle <YYYYMMDDHH>
etl/scripts/run-cycle-local.sh --dataset-id icon --cycle <YYYYMMDDHH>
```

Preview the local work without writing artifacts:

```bash
etl/scripts/run-cycle-local.sh --dataset-id gfs --cycle <YYYYMMDDHH> --dry-run
```

Iterate on a smaller local slice:

```bash
etl/scripts/run-cycle-local.sh \
  --dataset-id gfs \
  --cycle <YYYYMMDDHH> \
  --frames "000 003" \
  --artifact cloud_layers
```

`--artifact` and `--frames` are for local iteration and targeted reruns. A
fresh filtered run may fail validation unless the rest of the required run
already exists under the same `run_id`.

## Local Cycle

Local runs use the same planned frame-worker shape as AWS, but launch those
workers in local Docker containers. The wrapper builds or refreshes the
`weather-map-etl:local` image, then delegates to:

```bash
.venv/bin/weather-etl run-cycle --dataset-id gfs --cycle <YYYYMMDDHH>
```

The local lifecycle is:

```text
init-run -> plan-cycle -> run-frame containers -> validate-cycle -> publish-cycle
```

By default local runs publish public manifests and refresh local `status.json`.
Use `--no-publish` to stop after validation:

```bash
etl/scripts/run-cycle-local.sh --dataset-id gfs --cycle <YYYYMMDDHH> --no-publish
```

Omitting `--run-id` creates a new run attempt. Passing `--run-id <run_id>`
resumes that run and skips frames whose completion markers are already complete.
Local runs do not use persistent DynamoDB frame claims.

Local outputs go under the repo-level `artifacts/` directory. Downloads and
prepared GRIB files are cached under `etl/cache/`.

## AWS Submission

Manual AWS submission is intentionally narrower than local `run-cycle`: it
submits Batch workers only.

```bash
etl/scripts/run-cycle-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH> --dry-run
etl/scripts/run-cycle-aws.sh --dataset-id gfs --cycle <YYYYMMDDHH>
```

The AWS path creates or resumes a run, snapshots the deployed product config,
plans frame workers, skips complete or actively claimed frames, and submits the
remaining workers to Batch.

It does not validate or publish inline. In production, the scheduled
`weather-etl-publisher` Lambda validates complete runs, publishes manifests,
updates `manifests/index.json`, and refreshes root `status.json`.

Use `infra/terraform/weather-etl/README.md` for deeper production deploy and
AWS operator details.

## Debug CLI

The shell wrappers are the normal human entrypoints. These commands are useful
when you need to inspect or run one piece of the lifecycle:

```bash
.venv/bin/weather-etl list-datasets
.venv/bin/weather-etl list-frames --dataset-id <dataset_id>

.venv/bin/weather-etl init-run --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/weather-etl plan-cycle --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id> --json
.venv/bin/weather-etl run-frame --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id> --frame-id <FFF>
.venv/bin/weather-etl validate-cycle --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>
.venv/bin/weather-etl publish-cycle --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>

.venv/bin/weather-etl runs --dataset-id <dataset_id> --cycle <YYYYMMDDHH>
.venv/bin/weather-etl status --dataset-id <dataset_id> --cycle <YYYYMMDDHH> --run-id <run_id>
```

`runs` and `status` are read-only inspection commands. `publish-cycle` refuses
runs without a passing `validation.json`.

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
- `workers/`: frame worker specs, worker plans, frame claims, and local
  Docker / AWS Batch launch mechanics.
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
bash -n etl/scripts/run-cycle-local.sh
bash -n etl/scripts/run-cycle-aws.sh
```
