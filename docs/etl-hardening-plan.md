# ETL Hardening Plan

Working plan for making forecast ETL publishing more robust, easier to
operate, and easier to roll back. This is intentionally provisional: it names
the target shape and implementation direction without locking in every detail.

## Goal

The ETL should make cycle processing and publication explicit, auditable, and
recoverable. A failed hour, stale manifest, wrong-cycle submit, config change,
or partial rerun should not corrupt the public latest cycle or make rollback
hard.

The target design separates produced run artifacts from promoted public
aliases:

- workers produce immutable run-scoped outputs
- a validator proves a run is internally complete and compatible
- a promoter updates stable public pointers only after validation
- operators can inspect, promote, roll back, and clean up runs deliberately

## Current Fragility

Before the first hardening tasks, each hour job could write outputs and then
attempt publication. That made publication race with partial completion and
stale state. Outputs were also organized by artifact type first, which made
reruns overwrite prior attempts and made wrong-cycle cleanup more error-prone.

Recent stale `latest.json` issues are an example: an otherwise successful hour
job failed because aggregate forecast-manifest publishing read an old model
latest manifest with an incompatible schema.

## Completed

### 1. Stop Publishing From Every Hour Job

Hour workers should only process source data and write payloads plus success
markers. They should not attempt to publish cycle manifests or aggregate
forecast manifests.

Implemented direction:

- `forecast-etl run-hour` is focused on one `(model, cycle, fhour)` and only
  writes field payloads plus success markers
- `forecast-etl publish-cycle` provides an explicit publish command
- the scheduled publisher owns production manifest publication
- local `forecast-etl run-cycle` and `etl/scripts/run-cycle.sh` keep the
  ergonomic behavior of publishing once after all local hour work completes

### 2. Add a Run ID and Public Run Contract

Implemented direction:

- `cycle` remains the canonical forecast cycle id in `YYYYMMDDHH` format
- `run_id` identifies one rerun/attempt and is generated once per submitted
  cycle
- Batch workers receive the shared `RUN_ID`
- success markers include `run_id`, code revision, image identity,
  config digest, model, cycle, forecast hour, and artifact ids
- automatic GFS and ICON ingest share a small per-cycle run-id coordinator so
  individual events for the same cycle do not fragment into separate runs
- public run identity includes `cycle`, `runId`, `generatedAt`, and `revision`
- the frontend manifest supports compact payload references:
  run-level `payloadRoot`, artifact-level `payloadFile`, and artifact-level
  `byteLength` when uniform across frames
- the frontend payload loader and payload cache scope use model, cycle, run id,
  and revision, with fallback to the old inferred
  `fields/<model>/<cycle>/<fhour>/...` layout while old manifests exist

Public payload resolution:

```text
run.payloadRoot = runs/gfs/2026053018/<run_id>/fields
artifact.payloadFile = tmp_surface.field.i8.bin
payload path = <payloadRoot>/<fhour>/<payloadFile>
```

### 3. Move Produced Outputs to a Run-First Layout

Implemented direction:

- new ETL field payloads, success markers, logs, run metadata, config/catalog
  snapshots, internal run manifests, and publish markers are written under the
  run prefix
- publisher inputs read run-first markers only; without an explicit run id,
  publishing requires exactly one run id for the model/cycle
- public model cycle/latest aliases and the aggregate forecast manifest still
  live under `manifests/`
- public `payloadRoot` points at the selected run's field prefix
- lifecycle, IAM, CloudFront, and local dev serving now cover
  `/runs/*/fields/*` while retaining legacy `/fields/*` during transition

```text
runs/<model>/<cycle>/<run_id>/
  run.json
  config/
    pipeline_config.json
    forecast_catalog.json
  fields/<fhour>/<artifact>.field.<dtype>.bin
  status/<artifact>/<fhour>._SUCCESS.json
  manifest.json
  _PUBLISHED.json
```

This keeps reruns isolated, makes wrong-cycle cleanup straightforward, and
allows multiple attempts for the same cycle to coexist.

Detailed per-frame evidence, including exact payload paths, byte lengths,
checksums, source metadata, and marker provenance, belongs in internal run
manifests and validation reports under the run prefix. The hot-path frontend
manifest should continue to expose only compact payload references.

## Proposed Work

### 4. Snapshot Config Per Run

Workers now snapshot the effective pipeline config and forecast catalog into
the run prefix. The remaining hardening step is to make workers read from an
already-created run snapshot, so a mid-run config deployment cannot change what
remaining workers produce.

Provisional implementation:

- submit tooling or an orchestrator creates the run snapshot before hour
  workers launch
- workers read config from the run snapshot URI
- run metadata continues to record config digests

### 5. Make Validation Explicit

Validation should be a separate step between production and promotion.

Provisional implementation:

- validate all expected forecast hours and artifact ids exist
- validate marker schema, marker contents, payload checksums, grid consistency,
  encoding metadata, config digest, and run id consistency
- write a validation report under the run prefix
- require a successful validation report before promotion

### 6. Publish by Pointer, Not by Overwrite

Promotion should update small public aliases to point at a validated run. The
validated run outputs should remain immutable.

Provisional target layout:

```text
manifests/<model>/cycles/<cycle>/runs/<run_id>.json
manifests/<model>/cycles/<cycle>/current.json
manifests/<model>/latest.json
manifests/forecast-manifest.json
```

Rollback should be a pointer update to a previous validated run, not a rerun or
manual object rewrite.

### 7. Keep Latest Pointer Schema Stable

Public latest aliases should have a small, stable schema that can survive cycle
manifest format changes.

Provisional pointer shape:

```json
{
  "schema": "weather-map.model-latest-pointer",
  "model": "gfs",
  "cycle": "2026053018",
  "runId": "20260531T012233Z-a1b2c3d4",
  "manifestPath": "manifests/gfs/cycles/2026053018/runs/20260531T012233Z-a1b2c3d4.json"
}
```

If frontend or backend consumers still require full manifests at
`manifests/<model>/latest.json`, transition in phases: keep writing the full
latest manifest first, then add or switch to the pointer once readers support
it.

### 8. Pin and Record Release Identity

Each run should record the exact worker image and code/config identity used to
produce it.

Provisional implementation:

- record ECR image digest in `run.json`
- record git SHA and pipeline config digest
- later, allow submit tooling to choose an explicit image digest for rollback
  or controlled backfill runs

### 9. Use a Small State Table for Orchestration

DynamoDB should track workflow state and locks, not replace S3 artifact
markers.

Provisional implementation:

- one run row keyed by model, cycle, and run id
- optional per-hour state rows for progress and retry accounting
- states such as `submitted`, `processing`, `processed`, `validated`,
  `promoted`, `superseded`, and `failed`
- conditional writes for promotion locks and latest pointer updates

S3 remains the source of truth for payload evidence: field payloads, success
markers, manifests, and validation reports.

### 10. Add Backfill Safety

Submitting an older cycle should be explicit. This protects against accidental
wrong-year or wrong-cycle runs.

Provisional implementation:

- compare requested cycle against current latest for the model
- require a `--backfill` or `--force-older-than-latest` flag when submitting an
  older cycle
- include clear dry-run output before submission

### 11. Add an Operator CLI

A small operator command can make recurring actions safer than shell scripts
with growing flag sets.

Provisional commands:

```bash
etlctl submit --model gfs --cycle 2026053018
etlctl status --model gfs --cycle 2026053018
etlctl runs --model gfs --cycle 2026053018
etlctl validate --model gfs --cycle 2026053018 --run-id <run_id>
etlctl promote --model gfs --cycle 2026053018 --run-id <run_id>
etlctl rollback --model gfs --to-cycle 2026053012
etlctl cleanup --model gfs --cycle 2025053018 --dry-run
```

Existing shell scripts can wrap this initially.

Lower-priority additions:

- list all known run ids for a cycle with completeness, validation, and
  published status
- inspect one run's `run.json`, config digest, image identity, marker count,
  missing markers, and manifest paths
- publish or promote an explicit run when more than one run exists for the same
  cycle

### 12. Add Cleanup and Retention Policy

Run-scoped outputs make cleanup safer, but cleanup still needs explicit policy.

Provisional implementation:

- keep promoted runs longer
- expire failed or unpromoted runs sooner
- keep validation reports and promoted manifests long enough for audit and
  rollback
- provide dry-run cleanup commands before destructive deletes

### 13. Improve Observability

Operators need one run-level answer for current state.

Provisional implementation:

- summarize expected jobs, completed jobs, failed jobs, missing hours,
  validation status, promoted manifest path, and latest pointer state
- link run state to CloudWatch logs and Batch job ids
- expose a compact status command before adding dashboards

### 14. Remove Transition Compatibility After Cutover

This is intentionally a final cleanup task. Do not do it until all public
manifests that infer legacy `fields/<model>/<cycle>/<fhour>/...` payload paths
have aged out and production has been stable on run-first manifests.

Catalog and remove compatibility code introduced for the run-first transition:

- frontend legacy payload path fallback for manifests without `run.payloadRoot`
  and `artifact.payloadFile`
- frontend tests and fixtures that exist only to prove old inferred `/fields/`
  payload paths still work
- Vite dev proxy and artificial-delay handling for legacy `/fields/*`
- local nginx `/fields/` serving once local artifacts no longer need old
  manifests
- CloudFront artifact-origin coverage for `/fields/*`
- S3 lifecycle rules for old top-level `fields/`, `status/`, and `logs/`
  prefixes after those objects have expired
- IAM permissions for old top-level `fields/`, `status/`, and `logs/` prefixes
  where no current Lambda, backend, or worker path still needs them
- docs that describe the old type-first layout as anything other than
  historical context

Keep a checklist in the PR for this task. The risk is not technical complexity;
it is deleting a fallback before the last old manifest or local workflow has
stopped using it.

## Priority

Remaining highest leverage first:

1. Add separate validate and promote steps.
2. Snapshot config per run.
3. Validate marker contents and require one consistent run.
4. Add stable latest pointers and rollback.
5. Add backfill safety checks.
6. Add DynamoDB run state and promotion locks.
7. Pin and record release identity more strictly.
8. Add the operator CLI.
9. Add cleanup/retention automation.
10. Improve observability.
11. Remove transition compatibility after old manifests age out.

## De-Prioritized Work

- Do not start with a large operator CLI. First make the underlying operations
  safe and explicit.
- Do not migrate all historical artifacts in one pass. Use the new layout for
  new runs and keep readers compatible during transition.
- Do not move success markers into DynamoDB. Keep S3 markers as immutable
  artifact evidence and use DynamoDB for workflow state.
- Do not require strict digest-pinned execution before run metadata exists.
  Record image digests first, then tighten execution controls later.
- Do not remove `/fields/*` compatibility immediately. It is operational
  cleanup, not part of making current run-first publishing work.
- Do not add duplicate-skip logic to GFS ingest unless duplicate job submission
  becomes a real cost or operational issue. GFS ingest is event-driven and does
  not currently list marker state before submitting.

## Transition Notes

The existing type-first layout can coexist with the new run-first layout during
the transition. New runs should write to `runs/`, while existing frontend and
backend readers can continue using current public manifest paths until compact
run-first payload references are supported.

During migration, public behavior should remain: the frontend reads a current
forecast manifest and model latest references. The internal mechanism for
choosing and promoting those references can change behind that contract.

The frontend should first support compact run-first payload references with a
fallback to the old inferred `fields/<model>/<cycle>/<fhour>/...` layout. Once
old manifests have aged out, the fallback can be removed.
