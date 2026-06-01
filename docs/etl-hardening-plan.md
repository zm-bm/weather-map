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
  and revision

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
- lifecycle, IAM, CloudFront, and local dev serving cover `/runs/*/fields/*`

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
- legacy `manifests/<model>/<cycle>.json` objects are no longer written or read
  by current ETL/backend paths

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

### 8. Add Backfill Safety

Submitting an older cycle should be explicit. This protects against accidental
wrong-year or wrong-cycle runs.

Implemented direction:

- `forecast-etl check-backfill` compares a requested cycle against the current
  model latest alias
- manual `submit-cycle.sh` runs the guard before creating run snapshots or
  submitting Batch jobs
- manual older-cycle submits fail closed unless `--backfill` is passed
- automatic GFS and ICON ingest skip older-than-latest candidates instead of
  submitting them by default
- missing latest aliases are treated as bootstrap and allowed
- malformed or unreadable latest aliases fail closed for manual submits and are
  skipped by automatic ingest
- dry-run submit output includes the backfill check result

### 9. Add Minimal Operator Status Commands

A small operator surface should answer common questions without growing every
shell script into a dashboard. Keep it intentionally narrow until real
operations create pressure for more.

Implemented direction:

```bash
forecast-etl runs --model gfs --cycle 2026053018 [--json]
forecast-etl status --model gfs --cycle 2026053018 [--run-id <run_id>] [--json]
forecast-etl pointers --model gfs [--cycle 2026053018] [--json]
```

- the first operator commands stay inside the existing `forecast-etl` CLI
- commands are read-only and do not submit, validate, publish, clean up, or
  write state
- each command supports line-oriented human output and `--json` for scripts
- `forecast_etl.operator_status` reads artifact state and returns structured
  status objects; CLI code only parses arguments and formats reports
- use the run-first artifacts and public manifest pointers as the source of
  truth; do not create a separate operator state store
- `runs` lists known run ids for a cycle, newest first, with completeness,
  validation, and published/current/latest status
- `status` summarizes one selected run's `run.json`, config digest, expected
  marker count, completed marker count, missing hours/artifacts, validation
  status, published marker state, public run manifest path, cycle current
  pointer, and model latest pointer
- without `--run-id`, `status` may select the only run for the cycle or the
  newest run for operator visibility, but should clearly report when multiple
  runs exist and publication would require an explicit run id
- `pointers` inspects model latest and cycle current pointers, dereferences the
  referenced public run manifests, and reports stale or malformed pointer
  diagnostics
- keep same-cycle promotion as the existing explicit operation:
  `forecast-etl publish-cycle --model <model> --cycle <cycle> --run-id <run_id>`
- no separate `etlctl`, dashboard, DynamoDB-derived status view, or broader
  operator wrapper was introduced

### 10. Add Cleanup and Retention Policy

Run-scoped outputs make cleanup safer, but cleanup still needs explicit policy.

Implemented direction:

```bash
forecast-etl cleanup-runs --model gfs [--cycle 2026060118] [--json]
forecast-etl cleanup-runs --model gfs [--cycle 2026060118] --delete --yes
```

- cleanup reports candidates by default and deletes only when `--delete --yes`
  is provided
- cleanup scans run-first outputs only; old top-level objects require separate
  explicit manual cleanup if they still exist
- distinguish cleanup candidates by promotion state: published/current/latest,
  validated but unpromoted, complete but failed validation, incomplete, and
  conflicting snapshot metadata
- model-latest and cycle-current runs are protected and never candidates
- aggressive default candidate ages are used for reporting: failed/incomplete
  after 1 day, complete or validated-but-unpromoted after 3 days, and
  published but superseded after 14 days
- output includes candidate/protected status, reason, age, object count, known
  bytes, unknown-size count, delete counts, and run prefix
- S3 lifecycle remains unchanged for now: `runs/` expires after 14 days and
  `manifests/` expires after 45 days

### 11. Remove Transition Compatibility After Cutover

Implemented direction:

- frontend manifests now require `run.runId`, `run.payloadRoot`, and artifact
  `payloadFile`
- frontend payload loading resolves only `<payloadRoot>/<fhour>/<payloadFile>`
- ETL/backend latest aliases are pointer-only; full-manifest
  `manifests/<model>/latest.json` aliases are treated as malformed
- ETL/backend history and health inspect `cycles/<cycle>/current.json` pointers
  and no longer list legacy `manifests/<model>/<cycle>.json` aliases
- aggregate forecast-manifest generation requires compact payload refs and no
  longer derives `payloadFile` from per-frame paths
- Vite, local nginx, CloudFront, IAM, and S3 lifecycle coverage for old
  top-level `/fields`, `/status`, and `/logs` prefixes was removed where it was
  no longer needed
- existing legacy objects were not deleted by this task; object deletion is
  left to separate explicit manual cleanup

## Priority

Recommended implementation order:

1. Deploy and run at least one real production cycle before adding more moving
   pieces.
2. Implement Task 10 when local or S3 run clutter becomes operationally
   annoying; start with dry-run cleanup.
3. Add an `etlctl` wrapper or promotion aliases only if the direct
   `forecast-etl` commands become awkward in real operation.

## De-Prioritized Work

- Do not start with a large operator CLI. First make the underlying operations
  safe and explicit.
- Do not migrate all historical artifacts in one pass. Use the new layout for
  new runs and let old objects expire or clean them explicitly.
- Do not move success markers into DynamoDB. Keep S3 markers as immutable
  artifact evidence and use DynamoDB for workflow state.
- Do not add a DynamoDB orchestration state table until S3 run evidence,
  validation reports, and pointer state are insufficient for real operations.
- Do not require strict digest-pinned execution or ECR digest provenance until
  production forensics become important. Existing run id, code revision, image
  identity, config digest, and config/catalog snapshots are enough for current
  fix-forward operation.
- Do not make validation read every payload object until marker-only validation
  and pointer promotion have proven stable in production.
- Do not optimize away the duplicate marker reads in `publish-cycle` until the
  validate/promote/rollback path has been exercised in production.
- Do not split validation into a separate Lambda or Batch job unless the
  publisher Lambda starts running too long or competing with publication.
- Do not add duplicate-skip logic to GFS ingest unless duplicate job submission
  becomes a real cost or operational issue. GFS ingest is event-driven and does
  not currently list marker state before submitting.

## Cutover Notes

The run-first cutover is complete for current readers and publishers. New
public manifests must carry compact run-first payload references, and direct
model latest reads return pointer objects rather than full manifests.

Old type-first artifacts may still exist in S3 or local artifact directories,
but current code does not depend on them. Remove them manually after confirming
they are no longer needed.

Local filtered runs are still full-workload validation runs. A fresh
`--artifact` subset run is expected to fail validation unless the omitted
artifacts already exist under the same run id; use this mode for iteration or
resuming a known run, not as proof that the full cycle is publishable.
