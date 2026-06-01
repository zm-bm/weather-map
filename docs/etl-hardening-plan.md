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
  validation.json
  manifest.json
  _PUBLISHED.json
```

This keeps reruns isolated, makes wrong-cycle cleanup straightforward, and
allows multiple attempts for the same cycle to coexist.

Detailed per-frame evidence, including exact payload paths, byte lengths,
checksums, source metadata, and marker provenance, belongs in internal run
manifests and validation reports under the run prefix. The hot-path frontend
manifest should continue to expose only compact payload references.

### 4. Snapshot Config Per Run

Implemented direction:

- `forecast-etl init-run` creates or verifies a run snapshot before hour
  workers launch
- local and manual submit tooling create the run snapshot first, then pass
  run-scoped config/catalog URIs to workers and publishers
- automatic GFS and ICON ingest coordinate the run id, ensure the run snapshot,
  derive workload from that snapshot, and submit workers with pinned
  config/catalog URIs
- manual AWS submits use the Terraform-deployed config/catalog as the source
  of truth for the run snapshot
- `publish-cycle` and the scheduled publisher load expected workload and
  aggregate forecast-manifest catalog data from the selected run snapshot
- a mid-run config deployment no longer changes what remaining workers or the
  publisher read for that run

### 5. Make Validation Explicit

Implemented direction:

- `forecast-etl validate-cycle` validates one run and writes
  `runs/<model>/<cycle>/<run_id>/validation.json`
- first-pass validation checks run snapshot and success marker completeness,
  identity, config digest, artifact metadata, payload URI shape, and grid
  consistency
- validation currently trusts marker byte-length/checksum metadata and does
  not read/decompress every payload object
- `publish-cycle` refuses missing or failed validation reports before writing
  public aliases or `_PUBLISHED.json`
- the scheduled publisher validates complete candidate runs when needed, then
  publishes only runs with passing validation
- local `run-cycle` and `etl/scripts/run-cycle.sh` validate after workers
  finish; `--no-publish` skips only public publication, not validation

### 6. Publish by Pointer, Not by Overwrite

Implemented direction:

- publishing writes an immutable public run manifest for each promoted run
- cycle `current.json` and model `latest.json` are small pointer objects, not
  full manifest rewrites
- same-cycle rollback is a pointer update to a previously validated/published
  run via `publish-cycle --run-id`
- older-cycle latest rollback remains intentionally out of scope until explicit
  operator force-promotion tooling exists
- legacy `manifests/<model>/<cycle>.json` objects are no longer written for new
  publishes, but low-cost read fallback remains while old objects age out

Public manifest layout:

```text
manifests/<model>/cycles/<cycle>/runs/<run_id>.json
manifests/<model>/cycles/<cycle>/current.json
manifests/<model>/latest.json
manifests/forecast-manifest.json
```

### 7. Keep Latest Pointer Schema Stable

Implemented direction:

- `manifests/<model>/latest.json` now uses the stable latest-pointer schema
- `manifests/<model>/cycles/<cycle>/current.json` uses the matching
  cycle-current-pointer schema
- ETL and backend readers dereference pointers before inspecting latest run
  metadata or building the aggregate frontend manifest
- malformed or stale pointers fail closed for that model instead of corrupting
  `manifests/forecast-manifest.json`
- the frontend still starts from `manifests/forecast-manifest.json`; it does
  not fetch model `latest.json` on the hot path

Latest pointer shape:

```json
{
  "schema": "weather-map.model-latest-pointer",
  "schemaVersion": 1,
  "model": "gfs",
  "cycle": "2026053018",
  "runId": "20260531T012233Z-a1b2c3d4",
  "revision": "manifest-revision",
  "generatedAt": "2026-05-31T01:22:33Z",
  "manifestPath": "manifests/gfs/cycles/2026053018/runs/20260531T012233Z-a1b2c3d4.json"
}
```

## Proposed Work

### 8. Pin and Record Release Identity

Each run should record the exact worker image and code/config identity used to
produce it.

Keep the first pass mostly observational: record identity accurately before
requiring strict digest-pinned execution.

Provisional implementation:

- record ECR image digest in `run.json`
- record git SHA and pipeline config digest
- later, allow submit tooling to choose an explicit image digest for rollback
  or controlled backfill runs

### 9. Use a Small State Table for Orchestration

DynamoDB should track workflow state and locks, not replace S3 artifact
markers.

Defer this until validation and pointer promotion are in place and have had at
least one real deploy/run. It is useful, but it adds another moving piece and
should not be required for the next production cutover.

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

This is small and high-value, and should be done before adding broader operator
tooling.

Provisional implementation:

- compare requested cycle against current latest for the model
- require a `--backfill` or `--force-older-than-latest` flag when submitting an
  older cycle
- include clear dry-run output before submission

### 11. Add an Operator CLI

A small operator command can make recurring actions safer than shell scripts
with growing flag sets.

Do this after the underlying validate/promote/rollback commands stabilize.
Existing shell scripts can keep wrapping the lower-level commands until then.

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
- inspect current public pointers and their dereferenced manifests, including
  stale or malformed pointer diagnostics
- force-promote an older validated run to latest as an explicit rollback or
  backfill recovery action; keep this separate from normal monotonic promotion
  so accidental wrong-year submits do not become public latest cycles

### 12. Add Cleanup and Retention Policy

Run-scoped outputs make cleanup safer, but cleanup still needs explicit policy.

Defer until the new run-first validation/promotion flow has been deployed and
trusted.

Provisional implementation:

- keep promoted runs longer
- expire failed or unpromoted runs sooner
- keep validation reports and promoted manifests long enough for audit and
  rollback
- provide dry-run cleanup commands before destructive deletes
- identify orphaned local or S3 run prefixes left by failed `init-run`, aborted
  local cycles, interrupted Batch pushes, or incomplete manual submits
- distinguish cleanup candidates by promotion state: published/current/latest,
  validated but unpromoted, complete but failed validation, incomplete, and
  conflicting snapshot metadata
- add an operator-safe cleanup path for old local `artifacts/runs/...` attempts
  so repeated test runs do not require manual directory inspection

### 13. Improve Observability

Operators need one run-level answer for current state.

Add minimal status output as new workflow states are introduced, but defer
larger dashboards or reporting until the orchestration shape settles.

Provisional implementation:

- summarize expected jobs, completed jobs, failed jobs, missing hours,
  validation status, promoted manifest path, and latest pointer state
- link run state to CloudWatch logs and Batch job ids
- expose a compact status command before adding dashboards

### 14. Add Full Payload Byte and Checksum Validation

The first validation pass is intentionally marker-metadata-only. After the
marker validation and promotion flow has been deployed and observed, strengthen
validation by reading payload objects.

Provisional implementation:

- read/decompress every expected payload object or a configurable bounded
  sample if full validation proves too expensive
- verify marker `byte_length` and `sha256` against actual decoded payload bytes
- record payload validation mode, object read counts, and failures in
  `validation.json`
- keep marker-only validation available as an explicit emergency/degraded mode
  if S3 object reads become the bottleneck
- keep the initial publisher-owned validation path unless real Lambda runtime
  or concurrency pressure appears; if it does, split validation into a separate
  scheduled Lambda or Batch job that writes `validation.json` for the publisher
  to consume
- revisit whether `publish-cycle` still needs to re-read all success markers
  once pointer promotion is in place and validation reports are trusted as the
  publish gate

### 15. Remove Transition Compatibility After Cutover

This is intentionally a final cleanup task. Do not do it until all public
manifests that infer legacy `fields/<model>/<cycle>/<fhour>/...` payload paths
have aged out and production has been stable on run-first manifests.

Catalog and remove compatibility code introduced for the run-first transition:

- frontend legacy payload path fallback for manifests without `run.payloadRoot`
  and `artifact.payloadFile`
- frontend tests and fixtures that exist only to prove old inferred `/fields/`
  payload paths still work
- ETL/backend fallback readers for legacy full-manifest
  `manifests/<model>/latest.json` objects
- ETL/backend fallback readers for legacy cycle manifests at
  `manifests/<model>/<cycle>.json`
- health/history compatibility that lists legacy cycle manifests once all
  current production history comes from `cycles/<cycle>/current.json` pointers
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

Recommended implementation order:

1. Commit completed Tasks 4 and 5 before continuing so the snapshot and
   validation cutovers are isolated.
2. Implement Tasks 6 and 7 together: pointer promotion, stable latest pointer
   schema, rollback, and required frontend/backend reader changes.
3. Implement Task 10: backfill safety checks for manual and automated submits.
4. Implement Task 8: record release identity more strictly, without requiring
   strict digest-pinned execution yet.
5. Deploy and run at least one real production cycle before adding more moving
   pieces.
6. Implement Task 9: DynamoDB run state and promotion locks.
7. Implement Task 11: operator CLI over the now-stable lower-level commands.
8. Implement Task 12: cleanup/retention automation.
9. Implement Task 13: broader observability.
10. Implement Task 14 if marker-only validation is not enough operationally.
11. Implement Task 15 only after old public manifests have aged out.

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
- Do not make validation read every payload object until marker-only validation
  and pointer promotion have proven stable in production.
- Do not optimize away the duplicate marker reads in `publish-cycle` until the
  validate/promote/rollback path has been exercised in production.
- Do not split validation into a separate Lambda or Batch job unless the
  publisher Lambda starts running too long or competing with publication.
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

Local filtered runs are still full-workload validation runs. A fresh
`--artifact` subset run is expected to fail validation unless the omitted
artifacts already exist under the same run id; use this mode for iteration or
resuming a known run, not as proof that the full cycle is publishable.
