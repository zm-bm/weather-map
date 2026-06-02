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

The ETL should have one clear application model for a dataset run. Local runs,
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

- `dataset_id` identifies the configured data product, such as `gfs`, `icon`,
  `radar`, or `goes-east-ir`.
- `cycle` remains the canonical UTC batch/window/source issue id in
  `YYYYMMDDHH` format.
- `run_id` identifies one attempt for a `(dataset_id, cycle)`.
- All worker outputs, success markers, validation reports, internal manifests,
  public run manifests, and publish markers are tied to one run id.
- Automatic GFS and ICON ingest coordinate one run id per dataset/cycle before
  submitting workers.

### Run-Scoped Outputs

New ETL-produced outputs are immutable and run-first:

```text
runs/<dataset_id>/<cycle>/<run_id>/
  run.json
  config/pipeline_config.json
  config/forecast_catalog.json
  fields/<frame_id>/<artifact>.field.<dtype>.bin
  status/<artifact>/<frame_id>._SUCCESS.json
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

Public aliases remain under `manifests/`, but dataset latest and cycle current
aliases are pointers:

```text
manifests/<dataset_id>/cycles/<cycle>/runs/<run_id>.json
manifests/<dataset_id>/cycles/<cycle>/current.json
manifests/<dataset_id>/latest.json
manifests/data-manifest.json
```

The frontend hot path starts from `manifests/data-manifest.json`.
Payload references are compact and run-first:

```text
run.payload_root = runs/gfs/2026053018/<run_id>/fields
artifact.payload_file = tmp_surface.field.i8.bin
payload path = <payload_root>/<frame_id>/<payload_file>
```

Legacy manifest and `/fields/...` compatibility has been removed after cutover.

### Operator Surface

The current operator surface stays small:

```bash
forecast-etl runs --dataset-id gfs --cycle 2026053018 [--json]
forecast-etl status --dataset-id gfs --cycle 2026053018 [--run-id <run_id>] [--json]
forecast-etl pointers --dataset-id gfs [--cycle 2026053018] [--json]
forecast-etl cleanup-runs --dataset-id gfs [--cycle 2026053018] [--json]
forecast-etl cleanup-runs --dataset-id gfs [--cycle 2026053018] --delete --yes
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
  workflows/          init-run, run-frame, validate, publish, submit-cycle planning
  execution/          in-process, local-container, and AWS Batch execution adapters
  read_model/         pointer/status/cleanup/health readers for backend and CLI
  aws/                Lambda event parsing and AWS-specific adapters
  cli/                argparse, command dispatch, and output formatting
```

The most important split is not the exact folder names. The important split is
between these responsibilities:

- **Workflow:** what should happen for a dataset/cycle/run.
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
  generates one valid run id reused across `init-run`, every `run-frame`,
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
GFS SNS object event -> GFS ingest Lambda -> Batch frame workers
ICON EventBridge poll -> ICON ingest Lambda -> Batch frame workers
EventBridge schedule -> publisher Lambda -> validate/promote complete runs
```

This shape is sound: ingest submits work, frame workers produce run evidence,
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

- GFS is source-event driven. It coordinates one run id per dataset/cycle and
  snapshots config before submitting workers, but duplicate SNS events can
  still duplicate-submit the same frame for the same run.
- ICON is poll driven. It coordinates one run id per dataset/cycle, snapshots
  config before marker checks and submission, and already uses per-frame
  DynamoDB leases to suppress duplicate submissions.
- The publisher is artifact-state driven. It scans recent cycles, selects a
  run, validates when needed, promotes pointer-era manifests, and catches
  failures per dataset/cycle so one bad candidate does not block the rest.

Follow-ups classified by phase:

- Submission idempotency/resume phase: unify GFS and ICON duplicate-submission
  behavior with shared in-flight frame claims or an equivalent executor-neutral
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
  root, config/catalog inputs, dataset runtime, run snapshots, and run-id
  selection.
- `workflows.cycle` wraps init-run, run-frame, run-cycle, validate-cycle,
  publish-cycle, and backfill checks while leaving heavy processing and manifest
  publication in the existing implementation modules.
- `workflows.inspection` wraps operator read-side commands for runs, status,
  pointers, and cleanup.
- `workflows.publisher` owns the scheduled publisher's per dataset-cycle
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

### Completed: 2. Hard Cutover To Dataset/Frame Vocabulary And Add Cycle Plans

This phase is complete. It intentionally changed the public contract instead
of preserving old forecast/model/hour aliases.

The reusable planner/runtime primitives are now:

- `dataset_id`: general source/product identifier such as `gfs`, `icon`,
  `radar`, or `goes-east-ir`
- `cycle`: UTC batch, window, or source issue id in `YYYYMMDDHH`
- `run_id`: attempt identity for one dataset/cycle
- `artifact_id`: produced layer or product within that run
- `frame_id`: within-cycle time/index dimension

What changed:

- public ETL JSON contracts use snake_case dataset/frame fields
- config uses `datasets` and `workload.frames`
- CLI/env uses `--dataset-id`, `--frame-id`, `--frames`,
  `DATASET_ID`, `FRAME_ID`, and `PUBLISH_DATASETS`
- old hour/model command names became `run-frame`, `list-frames`, and
  `list-datasets`
- public manifests use dataset pointer schemas and
  `manifests/data-manifest.json`
- frontend manifest fetching, payload resolution, cache scoping, and health
  parsing use the dataset/frame contract
- backend health emits dataset-oriented snake_case JSON
- Terraform publisher config exposes datasets rather than models

The read-only planner command now emits the executor-neutral cycle plan:

```bash
forecast-etl plan-cycle --dataset-id gfs --cycle 2026060112 [--run-id <run_id>] [--frames "000 003"] [--artifact tmp_surface] [--no-publish] [--json]
```

The plan schema is `weather-map.etl-cycle-submission-plan` and includes
`dataset_id`, `cycle`, `run_id`, selected `frames`, selected `artifact_ids`,
run snapshot URIs, per-frame worker specs, validation, and optional
publication. It is read-only and does not create snapshots, submit jobs,
validate, publish, or write state.

### 3. Add Submission Idempotency And Resume Semantics

Goal: make duplicate events and reruns cheaper and less surprising by making
the cycle plan authoritative about what still needs to be submitted.

Provisional implementation:

- extend `CycleSubmissionPlan` with resume-aware frame state. Each selected
  frame should be classified before submission as `pending`, `complete`,
  `claimed`, `missing`, or `invalid`.
- treat omitted `--run-id` as a new attempt. Resuming an interrupted run should
  require an explicit `--run-id` so the operator knows which immutable run is
  being continued.
- define a complete frame from marker evidence, not marker existence alone. A
  complete frame has all selected artifact markers and those markers parse and
  match `dataset_id`, `cycle`, `run_id`, `frame_id`, config digest, artifact
  metadata, and expected run-first payload paths.
- add a shared `FrameClaimStore` adapter with conditional claim acquisition
  keyed by `dataset_id`, `cycle`, `run_id`, and `frame_id`.
- record useful claim diagnostics such as artifact ids, worker spec hash,
  source URI, Batch job id, `created_at`, and `expires_at`, without making the
  claim key more complex unless partial-artifact production becomes necessary.
- use DynamoDB as the current production claim implementation, but keep
  workflow logic written against the `FrameClaimStore` interface.
- migrate ICON's existing per-frame lease behavior toward the shared claim
  abstraction, and use the same abstraction to suppress duplicate GFS SNS
  submissions.
- keep job claims as submission throttles only. Validation reports and success
  markers remain the publication evidence and final completeness gate.
- do not rely on AWS Batch job names for idempotency. They are useful
  diagnostics, not the duplicate-submission guard.

Expected result:

- duplicate SNS/events or repeated manual submits do not create unnecessary
  duplicate frame jobs once a frame is complete or actively claimed
- interrupted runs can be resumed without changing run ids or manually
  filtering every completed frame
- GFS and ICON converge on the same duplicate-submission semantics even though
  their source triggers remain different
- Phase 5 can focus on local/AWS executor unification instead of rediscovering
  skip and claim policy in each executor

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
  - `--dataset-id`
  - `--cycle`
  - `--run-id`
  - `--frames`
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
  - aggregate data-manifest rebuild
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

- current dataset/latest pointer status
- cycle current run
- run completeness and validation status
- recent cycles/runs
- cleanup candidates
- public data-manifest summary

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
- future dataset additions such as HRRR or ECMWF can reuse source/processing
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
- proxy or summarize data manifest metadata
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
- no further manifest schema churn after the Phase 2 dataset/frame cutover
- no cloud migration as part of the first refactor pass
- no broad cloud-neutral framework; keep portability at storage, execution,
  scheduling, and coordination boundaries

## Success Criteria

The refactor is working when:

- `run-cycle.sh`, `submit-cycle.sh`, GFS ingest, and ICON ingest all derive
  worker jobs from one shared planner or workflow path
- Terraform exposes the ETL runtime contract clearly enough that scripts and
  Lambda configuration do not depend on incidental resource details
- a cycle plan can represent local and AWS worker submissions, frame state,
  resume decisions, and optional publish/validate steps without writing state
- duplicate complete or actively claimed frame jobs are suppressed, while
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
