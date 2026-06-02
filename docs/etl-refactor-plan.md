# ETL Refactor Plan

Last updated: 2026-06-02

This is the follow-on plan after completing `etl-hardening-plan.md`. The
hardening work made the ETL behavior safer: run-scoped outputs, explicit
validation, pointer-based publication, backfill safety, operator status, and
cleanup are now in place. The next goal is to make that behavior easier to
read, maintain, test, and reuse from both local and production entrypoints.
This refactor is primarily behavior-preserving, but it intentionally adds a
small number of behavior improvements where they reduce operational fragility:
provider-neutral cycle planning, submission idempotency/resume safety, and
minimal production observability.

## Goal

The ETL should have one clear application model for a forecast run. Local runs,
manual AWS submits, automatic ingest Lambdas, scheduled publishing, future
backend inspection, and tests should all use the same core workflow code where
possible.

The refactor should preserve the current behavior while improving module
boundaries and making the planned behavior changes explicit:

- local and production execution should differ mostly by executor, not by
  duplicated orchestration logic
- CLI and shell scripts should parse inputs and format output, not own business
  policy
- AWS Lambdas should parse events and call workflow functions, not implement
  alternate ETL paths
- backend/server code should be able to inspect public and run state without
  importing heavy extraction or worker-only modules
- tests should describe behavior by layer instead of relying on large
  all-purpose fixtures and broad mocked command tests
- intentional behavior changes should be narrow, documented, and covered by
  contract tests before deeper module cleanup

## Hardened Baseline

The completed hardening work established the current behavioral contract.
Keep this contract stable while refactoring.

### Run Identity

- `cycle` remains the canonical forecast cycle id in `YYYYMMDDHH` format.
- `run_id` identifies one attempt for a `(model, cycle)`.
- All worker outputs, success markers, validation reports, internal manifests,
  public run manifests, and publish markers are tied to one run id.
- Automatic GFS and ICON ingest coordinate one run id per model/cycle before
  submitting workers.

### Run-Scoped Outputs

New ETL-produced outputs are immutable and run-first:

```text
runs/<model>/<cycle>/<run_id>/
  run.json
  config/pipeline_config.json
  config/forecast_catalog.json
  fields/<fhour>/<artifact>.field.<dtype>.bin
  status/<artifact>/<fhour>._SUCCESS.json
  validation.json
  manifest.json
  _PUBLISHED.json
```

Current readers and publishers do not depend on old top-level `fields/`,
`status/`, or `logs/` prefixes.

### Validation And Publication

- Hour workers only write payloads and success markers.
- `validate-cycle` writes run-scoped `validation.json`.
- Publication requires a passing validation report.
- The scheduled publisher validates complete candidate runs when needed, then
  publishes.
- Local `run-cycle` keeps ergonomic behavior by validating and optionally
  publishing once after all local hour work finishes.

### Public Manifest Contract

Public aliases remain under `manifests/`, but model latest and cycle current
aliases are pointers:

```text
manifests/<model>/cycles/<cycle>/runs/<run_id>.json
manifests/<model>/cycles/<cycle>/current.json
manifests/<model>/latest.json
manifests/forecast-manifest.json
```

The frontend hot path starts from `manifests/forecast-manifest.json`.
Payload references are compact and run-first:

```text
run.payloadRoot = runs/gfs/2026053018/<run_id>/fields
artifact.payloadFile = tmp_surface.field.i8.bin
payload path = <payloadRoot>/<fhour>/<payloadFile>
```

Legacy manifest and `/fields/...` compatibility has been removed after cutover.

### Operator Surface

The current operator surface stays small:

```bash
forecast-etl runs --model gfs --cycle 2026053018 [--json]
forecast-etl status --model gfs --cycle 2026053018 [--run-id <run_id>] [--json]
forecast-etl pointers --model gfs [--cycle 2026053018] [--json]
forecast-etl cleanup-runs --model gfs [--cycle 2026053018] [--json]
forecast-etl cleanup-runs --model gfs [--cycle 2026053018] --delete --yes
```

These commands inspect or clean up run-first artifacts. They should not become
a second orchestration layer.

## Refactor Principles

- Preserve behavior first. Use characterization tests before moving code.
- Move policy out of shell scripts, CLI handlers, and Lambda handlers.
- Prefer a small application/workflow layer over broad utility modules.
- Keep domain math and binary encoding isolated from AWS, CLI, and manifest
  promotion code.
- Make dependencies point inward: CLI, scripts, and AWS adapters call workflow
  code; workflow code calls storage/repository/config/source/processing
  interfaces.
- Avoid introducing a framework. The ETL is small enough for plain Python
  modules, dataclasses, and explicit functions.
- Keep public contracts boring and documented. Refactors should not change S3
  paths, manifest schemas, exit codes, or operator output unless a task says so.
- Treat the behavior changes in this plan as explicit feature work, not
  incidental side effects of moving files.

## Target Package Shape

This is a target direction, not a requirement to move every file in one pass.

```text
forecast_etl/
  config/             load, validate, and resolve pipeline config/catalog
  storage/            local, S3, HTTP, and routing stores
  artifacts/          run paths, repositories, markers, snapshots, published state
  sources/            GFS, ICON, NOMADS, DWD source acquisition
  processing/         one-hour extraction, transformations, encoding
  workflows/          init-run, run-hour, validate, publish, submit-cycle planning
  execution/          in-process, local-container, and AWS Batch execution adapters
  read_model/         pointer/status/cleanup/health readers for backend and CLI
  aws/                Lambda event parsing and AWS-specific adapters
  cli/                argparse, command dispatch, and output formatting
```

The most important split is not the exact folder names. The important split is
between these responsibilities:

- **Workflow:** what should happen for a model/cycle/run.
- **Executor:** where/how that work runs.
- **Repository:** how artifacts are named, read, and written.
- **Reader:** how operator/backend code inspects existing state.
- **Adapter:** CLI, shell, Lambda, Batch, and local Docker glue.

## Recommended Order

### Completed: 0. Freeze The Hardened Contract

The first refactor step is complete. It was intentionally test-only and did
not move runtime modules, Terraform, or shell script behavior.

What was locked:

- local `run-cycle.sh` dry-run behavior now proves that an omitted `--run-id`
  generates one valid run id reused across `init-run`, every `run-hour`,
  `validate-cycle`, and optional `publish-cycle`
- manual `submit-cycle.sh` tests now exercise fake `init-run` and fake
  `aws batch submit-job`, proving deployed config/catalog inputs, run-scoped
  snapshot URIs, one shared run id, GFS source env, ICON no-source env, and
  scheduled-publisher operator messaging
- stale test vocabulary that implied old top-level status/manifests was
  tightened to run-first and pointer-era paths where those tests describe ETL
  contracts

Verification at completion:

```bash
cd etl && ../.venv/bin/python -m unittest discover forecast_etl/tests
cd etl && ../.venv/bin/ruff check forecast_etl
bash -n etl/scripts/run-cycle.sh
bash -n infra/scripts/weather-etl/ops/submit-cycle.sh
git diff --check
```

### Completed: 0A. Review Production Boundaries

The production boundary audit is complete. It found no reason to redesign the
current AWS flow before refactoring. The accepted baseline remains:

```text
GFS SNS object event -> GFS ingest Lambda -> Batch hour workers
ICON EventBridge poll -> ICON ingest Lambda -> Batch hour workers
EventBridge schedule -> publisher Lambda -> validate/promote complete runs
```

This shape is sound: ingest submits work, hour workers produce run evidence,
and the scheduled publisher reconciles complete runs from artifact state rather
than relying on a direct Batch completion callback.

Boundary map:

- event sources: GFS SNS object notifications, ICON EventBridge polling, and
  publisher EventBridge scheduling
- adapters: GFS ingest Lambda, ICON ingest Lambda, scheduled publisher Lambda,
  local Docker runner, and manual AWS submit script
- shared services: DynamoDB run coordinator, ICON state/lease table, artifact
  repository/store, Batch executor, and run snapshots
- portable workflow logic: config loading, run snapshot creation/loading,
  backfill checks, marker validation, manifest publication, pointer promotion,
  operator status, and cleanup candidate classification

Current intentional asymmetries:

- GFS is source-event driven. It coordinates one run id per model/cycle and
  snapshots config before submitting workers, but duplicate SNS events can
  still duplicate-submit the same forecast hour for the same run.
- ICON is poll driven. It coordinates one run id per model/cycle, snapshots
  config before marker checks and submission, and already uses per-hour
  DynamoDB leases to suppress duplicate submissions.
- The publisher is artifact-state driven. It scans recent cycles, selects a
  run, validates when needed, promotes pointer-era manifests, and catches
  failures per model/cycle so one bad candidate does not block the rest.

Follow-ups classified by phase:

- Submission idempotency/resume phase: unify GFS and ICON duplicate-submission
  behavior with shared in-flight hour claims or an equivalent executor-neutral
  mechanism.
- Planner/executor phase: keep AWS SNS, EventBridge, Lambda, Batch, and
  DynamoDB details behind adapters while local and AWS paths converge on the
  same cycle plan contract.
- Observability phase: add low-noise production visibility for Lambda errors,
  Batch failures, publisher failures, and stale public manifests.
- Infra refactor phase: leave Terraform restructuring to `0B. Infra Refactor
  Track`; the boundary audit should not mutate infrastructure.

### Completed: 0B. Infra Refactor Track

The Terraform cleanup is complete. The stack still uses the current AWS
production architecture, but the configuration now exposes the ETL runtime
contract deliberately instead of scattering operational defaults through
resource bodies.

What was clarified:

- one `weather-etl` stack remains the right shape for now
- Terraform has explicit variables/defaults for environment, name prefix,
  worker image tag, Batch retries/timeouts, Lambda timeouts, schedules, scan
  counts, and retention windows
- component IAM is expressed through readable policy documents
- GFS ingest, ICON ingest, and publisher all use the same Lambda zip/hash
- script-facing raw outputs remain stable, and a grouped
  `etl_runtime_contract` output is available for future planner/executor work
- `artifact_root_uri`, deployed config/catalog URIs, run coordinator, Batch
  executor, ingest triggers, and publisher schedule are explicit Terraform
  contract values
- artifact and config buckets intentionally allow force destroy because the ETL
  stack is still greenfield and clean redeploys are acceptable

Expected result:

- Terraform now matches the ETL workflow/executor contract instead of encoding
  hidden policy.
- A clean redeploy of ETL infra is easier while the project is still
  greenfield.
- Future R2 artifact storage or alternate executors can be added without
  untangling unrelated config, state, and IAM resources first.

### Completed: 1. Add Workflow/Application Context Scaffolding

The first Python boundary cleanup is complete. A small `forecast_etl.workflows`
package now centralizes shared setup and common workflow sequencing without
changing public commands, artifact paths, manifest schemas, shell script
interfaces, or Lambda behavior.

What changed:

- `ApplicationContext` resolves the URI store, artifact repository, artifact
  root, config/catalog inputs, model runtime, run snapshots, and run-id
  selection.
- `workflows.cycle` wraps init-run, run-hour, run-cycle, validate-cycle,
  publish-cycle, and backfill checks while leaving heavy processing and manifest
  publication in the existing implementation modules.
- `workflows.inspection` wraps operator read-side commands for runs, status,
  pointers, and cleanup.
- `workflows.publisher` owns the scheduled publisher's per model-cycle
  validate/promote candidate flow.
- CLI handlers and GFS/ICON/publisher Lambda adapters now route through the
  workflow layer, while keeping adapter-owned event parsing, env parsing, output
  formatting, exit-code mapping, and Batch submission shape.

Deferred on purpose:

- `run-cycle.sh` and `submit-cycle.sh` still keep their current interfaces and
  orchestration until the provider-neutral plan/executor phases.
- GFS duplicate SNS submission suppression remains deferred to the idempotency
  phase.
- The workflow package is not a cloud abstraction framework; AWS clients remain
  in AWS adapters.

### 2. Add A Provider-Neutral Cycle Submission Plan

Goal: represent one dataset/cycle run as a provider-neutral plan before
deciding whether the executor is local Docker, AWS Batch, or a future provider.
This is the main mechanism for converging local and production forecast behavior
without making the shell scripts own ETL policy, while leaving room for later
non-forecast ETL such as radar or satellite ingest.

Use these reusable planner primitives:

- `dataset_id`: general source/product identifier such as `gfs`, `icon`,
  `radar`, or `goes-east-ir`
- `cycle`: UTC batch, window, or source issue id in `YYYYMMDDHH`
- `run_id`: attempt identity for one dataset/cycle
- `artifact_id`: produced layer or product within that run
- `frame_id`: within-cycle time/index dimension

For the current forecast ETL, `dataset_id` maps to the existing `model` value
and `frame_id` maps to the existing forecast hour / `fhour` value. Do not rename
run-first S3 paths, public manifest fields, CLI flags, or worker env vars in this
phase; preserve forecast vocabulary at public adapter boundaries and use the
generalized names inside the planner.

Provisional implementation:

- introduce internal `DatasetCycleSubmissionRequest` and
  `DatasetCycleSubmissionPlan` structures
- add a read-only CLI command:

```bash
forecast-etl plan-cycle --model gfs --cycle 2026060112 [--run-id <run_id>] [--json]
```

- make JSON output the stable machine-readable contract for script and executor
  integration
- emit both the generalized identity fields and forecast aliases where useful:
  `datasetId`, `cycle`, `runId`, `frames[].frameId`, `artifacts[].artifactId`,
  plus `model`/`fhour` aliases for forecast workers
- support the same common operator inputs as the local/prod scripts where they
  affect the plan:
  - `--model`
  - `--cycle`
  - `--run-id`
  - `--fhours`
  - `--artifact`
  - config/catalog/artifact root URIs
- keep environment-specific execution flags out of the plan command; for
  example local `--procs` and `--rebuild`, or prod `--backfill`,
  `--skip-config-check`, `--source-bucket`, and submit pacing remain adapter
  concerns
- have the planner accept a request such as:

```python
DatasetCycleSubmissionRequest(
    dataset_id="gfs",
    cycle="2026060112",
    run_id="20260601T120000Z-a1b2c3d4",
    artifact_root_uri="...",
    source_config_uri="...",
    source_catalog_uri="...",
    selected_frame_ids=None,
    selected_artifact_ids=None,
)
```

- have the planner return a `DatasetCycleSubmissionPlan` containing:
  - dataset id, cycle, run id, and artifact root
  - forecast alias fields for current GFS/ICON callers
  - run snapshot intent
  - snapshot config/catalog URIs
  - selected frame ids
  - selected artifact ids
  - per-frame worker job specs
  - validation step
  - optional publish step
  - operator messages or structured summary fields
- keep the command read-only; it should not create snapshots, submit jobs,
  validate, publish, or write state
- generate or accept a run id according to the same rules as current local and
  manual submit paths
- compute run snapshot URIs, selected frame ids, selected artifact ids,
  per-frame worker environments, validation step, and optional publish step in
  one place
- make the plan explicit about whether an executor should include a GFS
  `GRIB_SOURCE_URI` or leave source acquisition to the worker/model source
  adapter, as ICON does

Expected result:

- run id generation, snapshot URIs, workload selection, and worker environment
  variables are represented once
- local and production execution can be compared by diffing plan objects rather
  than shell output
- later executor tests can assert plan input/output contracts instead of broad
  shell internals
- later radar/satellite ingest can reuse the planner shape without forcing those
  datasets into forecast-hour terminology

### 3. Add Submission Idempotency And Resume Semantics

Goal: make duplicate events and reruns cheaper and less surprising before the
submit paths are unified.

Provisional implementation:

- automatic ingest and manual submit skip already-complete forecast hours for
  the selected run
- add short-lived in-flight job claims keyed by model, cycle, run id, and
  forecast hour to suppress duplicate automatic submissions
- expired claims allow retry/resume
- keep the final completeness decision in validation; job claims are submit
  safety, not publication evidence
- keep the claim store behind the run-coordination adapter so DynamoDB is the
  current implementation but not hardcoded into workflow logic

Expected result:

- duplicate SNS/events or repeated manual submits do not create unnecessary
  duplicate hour jobs once an hour is complete or actively claimed
- interrupted runs can be resumed without changing run ids or manually
  filtering every completed hour

### 4. Slim The CLI Around The Workflow Layer

Goal: make `forecast-etl` a thin command surface, not the application layer.

Provisional implementation:

- move command handlers out of `cli.py` into command modules
- keep `cli.py` responsible for parser construction, dispatch, and common
  output formatting only
- keep exit codes and stdout/stderr behavior stable
- route command implementations through workflow functions and application
  context helpers

Expected result:

- adding a new command should not make `cli.py` materially harder to read
- command modules can be tested without constructing full argparse inputs

### 5. Unify Local And AWS Submit Paths Through Plans And Executors

Goal: make local and AWS submission execute the same plan with different
executor adapters. The two current main entrypoints should become thin
operator wrappers around the shared planner and executor layer.

Provisional implementation:

- add executor adapters for:
  - local Docker
  - AWS Batch
  - in-process test execution where useful
- make `etl/scripts/run-cycle.sh` execute the plan with the local Docker
  executor
- make `infra/scripts/weather-etl/ops/submit-cycle.sh` execute the plan with
  the AWS Batch executor
- keep these existing paths working as compatibility entrypoints during the
  refactor because they are the current local/prod operator commands
- consider adding clearer top-level wrappers after the shared planner exists,
  for example:

```text
scripts/weather-etl/run-local-cycle.sh
scripts/weather-etl/submit-aws-cycle.sh
```

- if clearer wrappers are added, have the old paths delegate to them instead of
  breaking operator muscle memory immediately
- keep common cycle inputs aligned across local and prod wrappers:
  - `--model`
  - `--cycle`
  - `--run-id`
  - `--fhours`
  - `--artifact`
  - `--dry-run`
- allow environment-specific flags where they describe real executor
  differences:
  - local-only examples: `--procs`, `--rebuild`, `--no-publish`
  - prod-only examples: `--backfill`, `--skip-config-check`,
    `--source-bucket`, `--job-name-prefix`, `--submit-delay-seconds`
- make GFS and ICON ingest Lambdas use the same planner after event parsing and
  run-id coordination
- keep local ergonomics: local cycle runs still validate and optionally publish
  after worker completion

Expected result:

- local and production disagree only in executor-specific details
- scripts no longer duplicate run id, snapshot URI, workload, and worker env
  policy
- the operator-facing script names and locations become deliberate rather than
  accidental

### 6. Split Manifest Publication

Goal: make publication easier to reason about and safer to change.

Provisional implementation:

- split `manifest/publish.py` into smaller modules or functions around:
  - run readiness and validation checks
  - marker collection and marker-to-frame conversion
  - internal run manifest construction
  - public run manifest writing
  - current/latest pointer promotion
  - aggregate forecast-manifest rebuild
- keep pointer schemas and public output unchanged
- make each stage return a structured result that can be logged or surfaced in
  operator commands

Expected result:

- same-cycle rollback and monotonic latest protection are obvious in code
- aggregate manifest rebuild rules are isolated and easier to test

### 7. Create A Backend-Friendly Read Model

Goal: prepare for a full backend server without coupling it to worker code.

Provisional implementation:

- move pointer inspection, run status, cleanup classification, and health-style
  reads into a lightweight read-side package
- ensure this package depends only on storage, artifact paths, pointer schemas,
  and manifest schemas
- keep GDAL, source acquisition, binary encoding, Batch, and Lambda code out of
  backend read paths
- design backend endpoints around this read model later, after the Python
  boundary is clean

Likely backend-facing queries:

- current model/latest pointer status
- cycle current run
- run completeness and validation status
- recent cycles/runs
- cleanup candidates
- public forecast-manifest summary

### 8. Add Minimal Production Observability

Goal: add low-noise production signals without turning operations into a
separate incident-management project.

Provisional implementation:

- add alerts for Lambda errors, Batch job failures, publisher failures, and
  stale latest/public manifest state
- do not send success notifications by default
- keep notification routing simple and explicit
- treat DLQs, richer incident workflows, and success summaries as optional
  follow-ups unless real failures show they are needed

Expected result:

- failed ingest, failed workers, failed publication, and stale public data are
  visible without manually polling every service
- routine successful cycles remain quiet

### 9. Clean Up Tests By Layer

Goal: keep coverage while making tests easier to read and cheaper to modify.

Provisional implementation:

- split broad files by behavior:
  - `test_cli.py` into command-specific tests
  - `test_manifest_publish.py` into readiness, manifest build, pointer
    promotion, idempotency, and rollback tests
  - `test_artifact_payload_flow.py` into scalar, vector, GFS derivation, ICON
    derivation, and precipitation overlay contract tests
- move reusable fake config/run/repository setup into focused fixture builders
- reduce mocks that assert internal call chains; prefer asserting output
  objects, stored artifacts, exit codes, and emitted plan specs
- keep heavy extraction/encoding tests where they prove binary contracts

Expected result:

- refactors fail tests only when behavior changes
- adding a new workflow or backend reader does not require copying large fake
  objects from unrelated tests

### 10. Clean Domain Modules Last

Goal: improve source/extract/encoding readability after orchestration is stable.

Provisional implementation:

- keep extraction and binary encoding behavior unchanged unless tests prove a
  bug
- separate source acquisition from artifact band extraction where currently
  tangled
- keep GFS and ICON source-specific behavior behind source adapters
- only introduce abstractions that remove real duplication or make artifact
  contracts clearer

Expected result:

- domain modules remain boring and testable
- future model additions such as HRRR or ECMWF can reuse source/processing
  contracts instead of copying GFS/ICON special cases

## Backend Server Considerations

The backend should be designed after the read model is separated. The server
should initially be a thin HTTP layer over stable read functions, not a second
source of ETL truth.

Avoid making the backend own:

- run selection for publishing
- validation
- pointer promotion
- worker submission
- cleanup policy

Good first backend responsibilities:

- serve status and health summaries
- expose recent runs and pointer diagnostics
- proxy or summarize forecast manifest metadata
- provide operator-safe views of cleanup candidates
- later, expose explicit operator actions by calling existing workflow
  functions

## Cloud Portability Guardrails

Cloud portability is a constraint on the refactor, not a near-term mandate to
move compute or storage. The current AWS production workflow can remain the
default while the ETL code becomes easier to run elsewhere if needed. This is
secondary to the AWS/local workflow cleanup.

Preferred direction:

- keep domain and workflow code cloud-neutral
- keep cloud-specific behavior in adapters
- avoid making every module generically cloud-abstract; add small interfaces
  only at real boundaries
- make storage provider choice explicit by URI scheme:
  - `s3://` for AWS S3
  - future `r2://` for Cloudflare R2
  - `file://` for local artifacts
  - `http(s)://` for read-only source/config inputs
- do not use hidden global boto3 endpoint overrides for R2 because GFS source
  reads still need normal AWS S3 access
- keep artifact repository code storage-oriented and provider-neutral
- build provider-neutral job specs before execution
- keep executor implementations separate:
  - local Docker
  - AWS Batch
  - future Cloudflare Queue/Workflow/Container executor if it becomes useful
- keep run coordination behind a small adapter:
  - DynamoDB now
  - Durable Object, D1, KV, or another provider-specific store later if needed
- keep validator and publisher logic based on object evidence and manifests,
  not AWS service events
- avoid relying on object-store features that are not part of the current
  `UriStore` contract unless the capability is isolated and tested

Potential R2 migration path:

- move artifact storage first, if public artifact serving cost or operational
  simplicity makes it worthwhile
- keep AWS Lambda and Batch compute initially
- set `ARTIFACT_ROOT_URI` to an explicit R2 URI once an R2 store exists
- keep AWS S3 for NOAA source reads and Terraform-managed config/catalog until
  there is a reason to move them
- move compute to Cloudflare only after the workflow/executor split is clean
  and AWS Batch is a real pain point

## Non-Goals For The First Refactor Pass

- no full rewrite
- no new orchestration framework
- no immediate pytest migration unless it falls out naturally
- no new `etlctl` binary until the existing CLI proves awkward
- no backend server before the read model boundary is clear
- no deep rewrite of encoding/extraction math as part of workflow cleanup
- no manifest schema churn unless a separate product/backend task requires it
- no cloud migration as part of the first refactor pass
- no broad cloud-neutral framework; keep portability at storage, execution,
  scheduling, and coordination boundaries

## Success Criteria

The refactor is working when:

- `run-cycle.sh`, `submit-cycle.sh`, GFS ingest, and ICON ingest all derive
  worker jobs from one shared planner or workflow path
- Terraform exposes the ETL runtime contract clearly enough that scripts and
  Lambda configuration do not depend on incidental resource details
- a read-only cycle plan can represent local and AWS worker submissions without
  writing state
- duplicate complete or actively claimed hour jobs are suppressed, while
  expired claims allow retry/resume and validation remains the publication gate
- `cli.py` is small enough to scan quickly
- publish, validate, status, cleanup, and backfill each have clear module
  boundaries
- backend-readable state can be inspected without importing worker-heavy code
- production failures and stale public data produce low-noise alerts, while
  successful cycles remain quiet by default
- artifact storage can be swapped by URI/store adapter without changing worker,
  validator, publisher, or frontend manifest semantics
- tests are organized by behavior and remain green through file moves
- no public S3 layout, manifest schema, frontend payload resolution, or
  operator command contract changes accidentally
