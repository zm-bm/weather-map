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

Today, each hour job can write outputs and then attempt publication. That makes
publication race with partial completion and stale state. Outputs are also
organized by artifact type first, which makes reruns overwrite prior attempts
and makes wrong-cycle cleanup more error-prone.

Recent stale `latest.json` issues are an example: an otherwise successful hour
job failed because aggregate forecast-manifest publishing read an old model
latest manifest with an incompatible schema.

## Proposed Work

### 1. Stop Publishing From Every Hour Job

Hour workers should only process source data and write payloads plus success
markers. They should not attempt to publish cycle manifests or aggregate
forecast manifests.

Provisional implementation:

- keep `forecast-etl run-hour` focused on one `(model, cycle, fhour)`
- add a separate publish or promote command/job
- have submit tooling create or trigger a publisher only after expected hour
  work has finished, or let an operator run it explicitly

### 2. Add a Run ID

Each cycle attempt should have a stable `run_id`. All outputs, markers, logs,
and validation reports for that attempt should carry the same `run_id`.

Provisional implementation:

- generate `run_id` at submit time
- pass it to every Batch worker as an environment variable
- include `run_id`, code revision, image identity, config digest, model, cycle,
  forecast hour, and artifact ids in run metadata and success markers

### 3. Move Produced Outputs to a Run-First Layout

Produced ETL outputs should be grouped by model, cycle, and run id instead of
being split first by `fields/`, `status/`, and `manifests/`.

Provisional target layout:

```text
runs/<model>/<cycle>/<run_id>/
  run.json
  config/
    pipeline_config.json
    forecast_catalog.json
  fields/<fhour>/<artifact>.field.<dtype>.bin
  status/<artifact>/<fhour>._SUCCESS.json
  manifest.json
  validation.json
```

This keeps reruns isolated, makes wrong-cycle cleanup straightforward, and
allows multiple attempts for the same cycle to coexist.

### 4. Snapshot Config Per Run

Workers in the same run should use the exact same pipeline config and forecast
catalog. A mid-run config deployment should not change what remaining workers
produce.

Provisional implementation:

- submit tooling copies the effective pipeline config and forecast catalog into
  the run prefix
- workers read config from the run snapshot
- run metadata records config digests

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
etlctl validate --model gfs --cycle 2026053018 --run-id <run_id>
etlctl promote --model gfs --cycle 2026053018 --run-id <run_id>
etlctl rollback --model gfs --to-cycle 2026053012
etlctl cleanup --model gfs --cycle 2025053018 --dry-run
```

Existing shell scripts can wrap this initially.

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

## Priority

Highest leverage first:

1. Stop hour-job publishing.
2. Add separate validate and promote steps.
3. Snapshot config per run.
4. Add `run_id` and run-first output layout.
5. Validate marker contents and require one consistent run.
6. Add stable latest pointers and rollback.
7. Add DynamoDB run state and promotion locks.
8. Add backfill safety checks.
9. Add operator CLI.
10. Tighten image digest pinning and cleanup policies.

## De-Prioritized Work

- Do not start with a large operator CLI. First make the underlying operations
  safe and explicit.
- Do not migrate all historical artifacts in one pass. Use the new layout for
  new runs and keep readers compatible during transition.
- Do not move success markers into DynamoDB. Keep S3 markers as immutable
  artifact evidence and use DynamoDB for workflow state.
- Do not require strict digest-pinned execution before run metadata exists.
  Record image digests first, then tighten execution controls later.

## Transition Notes

The existing type-first layout can coexist with the new run-first layout during
the transition. New runs should write to `runs/`, while existing frontend and
backend readers can continue using current public manifest paths until pointer
support is added.

During migration, public behavior should remain: the frontend reads a current
forecast manifest and model latest references. The internal mechanism for
choosing and promoting those references can change behind that contract.
