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

- Frame workers only write payloads and success markers.
- `validate-cycle` writes run-scoped `validation.json`.
- Publication requires a passing validation report.
- The scheduled publisher validates complete candidate runs when needed, then
  publishes.
- Local `run-cycle` keeps ergonomic behavior by validating and optionally
  publishing once after all local frame work finishes.

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
  processing/         frame extraction, transformations, encoding
  workflows/          init-run, run-frame, validate, publish, submit-cycle planning
  execution/          in-process, local-container, and AWS Batch execution adapters
  inspection/         pointer/status/cleanup/health readers for backend and CLI
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
- shared services: DynamoDB run coordinator, frame claim table, artifact
  repository/store, Batch executor, and run snapshots
- portable workflow logic: config loading, run snapshot creation/loading,
  backfill checks, marker validation, manifest publication, pointer promotion,
  operator status, and cleanup candidate classification

Asymmetries identified during the audit:

- GFS is source-event driven. It coordinates one run id per dataset/cycle and
  snapshots config before submitting workers. At audit time, duplicate SNS
  events could still duplicate-submit the same frame for the same run; Phase 3
  addressed this with shared frame claims.
- ICON is poll driven. It coordinates one run id per dataset/cycle, snapshots
  config before marker checks and submission, and originally used source-
  specific per-frame DynamoDB leases; Phase 3 replaced those leases with the
  shared frame claim table.
- The publisher is artifact-state driven. It scans recent cycles, selects a
  run, validates when needed, promotes pointer-era manifests, and catches
  failures per dataset/cycle so one bad candidate does not block the rest.

Follow-ups classified by phase:

- Submission idempotency/resume phase: completed in Phase 3 with shared
  in-flight frame claims.
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
  `etl_runtime_contract` output is available for backend, observability, and
  future executor work
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

- At Phase 1 completion, `run-cycle.sh` and `submit-cycle.sh` still owned
  orchestration; Phase 3 later made them thin wrappers around shared executors.
- At Phase 1 completion, GFS duplicate SNS submission suppression remained
  deferred; Phase 3 later added shared frame claims for GFS and ICON.
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

### Completed: 3. Submission Idempotency, Resume, And Executors

This phase is complete. It intentionally absorbed the previous separate
"Unify Local And AWS Submit Paths Through Plans And Executors" phase, because
resume decisions, frame claims, and executor behavior need to come from the
same plan.

What changed:

- `CycleSubmissionPlan` is now resume-aware. It includes ordered `frame_ids`,
  per-frame state, and workers only for frames eligible to submit.
- Frame states are `pending`, `complete`, `claimed`, `missing`, or `invalid`.
- Complete frames are defined from marker evidence, not marker existence alone:
  expected success markers must exist, parse, match dataset/cycle/run/frame and
  snapshot config metadata, and point at expected run-first payload paths.
- Omitted `--run-id` means "new attempt". Explicit `--run-id` resumes an
  existing attempt and lets the plan skip complete or actively claimed frames.
- `FrameClaimStore` is the shared claim boundary. Production uses a new
  DynamoDB table keyed by `dataset_id#cycle#run_id#frame_id`; local runs use
  marker evidence and do not need persistent claims.
- Claim records include artifact ids, worker spec hash, optional source URI,
  Batch job id, attempt, created/updated/expires timestamps, and TTL.
- Claims throttle submissions only. Success markers and validation reports
  remain the source of truth for publication.
- GFS ingest uses the shared plan and frame claims, so duplicate SNS events now
  skip complete or actively claimed frames.
- ICON ingest no longer uses source-specific lease helpers; it uses the same
  shared claim store and logs `claimed` terminology.
- `etl/scripts/run-cycle.sh` and `infra/scripts/weather-etl/ops/submit-cycle.sh`
  keep their existing interfaces but now delegate to shared executor commands.
- The local Docker executor runs init-run, plan, pending `run-frame` containers,
  validation, and optional publish.
- The AWS Batch executor runs backfill safety, init-run, plan, claim
  acquisition, Batch submit, and submission recording.
- Terraform now creates `weather-etl-frame-claims`, passes
  `FRAME_CLAIM_TABLE` to GFS/ICON ingest, and removes the old ICON-specific
  lease table.
- The worker image default command is `run-frame`, matching the Batch job
  definitions and container env contract.

Implemented interfaces:

- `forecast-etl plan-cycle` remains read-only and reports frame state plus
  worker specs.
- `forecast-etl execute-local-cycle` is the internal local Docker executor
  command used by `etl/scripts/run-cycle.sh`.
- `forecast-etl submit-aws-cycle` is the internal AWS Batch executor command
  used by `infra/scripts/weather-etl/ops/submit-cycle.sh`.
- `etl/scripts/run-cycle.sh` remains the human local entrypoint.
- `infra/scripts/weather-etl/ops/submit-cycle.sh` remains the human manual AWS
  submit entrypoint.

Frame claim table:

```text
table = weather-etl-frame-claims
pk = <dataset_id>#<cycle>#<run_id>#<frame_id>
state = claimed | complete
```

Claim records include:

```text
dataset_id
cycle
run_id
frame_id
artifact_ids
worker_spec_hash
source_uri
job_id
attempt
created_at
updated_at
expires_at_epoch
ttl
```

Claims are submission throttles only. They do not prove completion; marker
evidence and validation remain the publication gate.

Operational behavior:

- Re-running a manual submit without `--run-id` creates a new attempt.
- Re-running with `--run-id <existing>` resumes that immutable run and submits
  only frames that are not complete or actively claimed.
- Expired claims allow retry/resume.
- Local execution uses marker evidence to skip complete frames on explicit-run
  resumes, but does not persist active claims.
- Validation remains the final completeness gate before the scheduled publisher
  can promote a run.

Verification at completion:

```bash
cd etl && ../.venv/bin/python -m unittest discover forecast_etl/tests
cd etl && ../.venv/bin/ruff check forecast_etl
bash -n etl/scripts/run-cycle.sh
bash -n infra/scripts/weather-etl/ops/submit-cycle.sh
cd infra/terraform/weather-etl && terraform fmt -check && terraform validate
git diff --check
```

### Completed: 4. Slim The CLI Around The Workflow Layer

This phase is complete. `forecast_etl.cli` is now the CLI adapter package,
not a single large module. The old `forecast_etl/cli.py` file was removed
and the intermediate `forecast_etl.cli_support` package was folded into the
final `forecast_etl.cli` package.

What changed:

- command handlers moved into focused `forecast_etl.cli` modules by intent:
  lifecycle, submission/executor, read-only inspection, and small discovery
  commands
- parser declaration and dispatch live in `forecast_etl.cli.parser`
- shared CLI-only helpers moved with those handlers:
  config/runtime parser parents, `--artifact`, required env/flag fallback
  validation, `ApplicationContext` construction, key/value formatting, JSON
  formatting, and not-ready message formatting
- `submit-aws-cycle` now imports `boto3` lazily in its command handler instead
  of making every CLI import pay for AWS client setup
- `forecast_etl.cli.__init__` re-exports `main(argv)` and
  `build_arg_parser()`, so `forecast-etl = "forecast_etl.cli:main"` remains
  valid without a packaging change
- `python -m forecast_etl.cli ...` is handled by `forecast_etl.cli.__main__`,
  preserving the local and manual submit wrapper entrypoints
- command names, flags, env fallbacks, exit codes, stdout/stderr behavior,
  shell wrappers, workflows, manifests, and Terraform behavior did not change

Expected result:

- `forecast_etl.cli` is small enough to scan as command registration plus
  dispatch
- adding a new command should usually mean adding or changing a focused
  `forecast_etl.cli` module, not expanding the parser entrypoint
- workflows remain the application layer; CLI modules only translate
  argparse input into workflow calls and render results

### Completed: 5. Finish Splitting Manifest Publication

This phase is complete. `forecast_etl.manifest.publish.run_publish` remains
the stable public entrypoint, but the implementation now reads as a sequence of
publication stages instead of carrying every detail in one module.

What changed:

- manifest document construction stays in `manifest/build.py`
- pointer schemas and pointer dereference helpers stay in
  `manifest/pointers.py` and `manifest/inspect.py`
- aggregate `manifests/data-manifest.json` document generation stays in
  `manifest/data_manifest.py`
- scheduled publisher candidate orchestration stays in `workflows/publisher.py`
- publish readiness checks now live in `manifest/readiness.py`
- success-marker evidence collection now lives in
  `manifest/marker_evidence.py`
- internal/public run manifest promotion, `current.json`, `latest.json`,
  `_PUBLISHED.json`, same-cycle rollback, and monotonic latest rules now live
  in `manifest/promotion.py`
- aggregate data-manifest refresh decision rules now live in
  `manifest/data_manifest_refresh.py`
- pointer schemas, public output shape, CLI behavior, Lambda behavior, and
  shell-wrapper behavior did not change

Expected result:

- `run_publish` is a thin orchestration function
- same-cycle rollback and monotonic latest protection are isolated in the
  promotion stage
- aggregate manifest rebuild rules are independently testable
- publication-stage results can be reused by operator/status work without
  parsing publish stdout

### Completed: 6. Create A Backend-Friendly Inspection Layer

The backend-friendly inspection boundary is complete. It prepares for a full
backend server without coupling backend reads to worker, source, AWS adapter,
or binary extraction code.

What changed:

- `forecast_etl.inspection` now owns read-only artifact inspection for run
  status, pointer diagnostics, health/snapshot reads, cleanup candidate
  classification, and public data-manifest summaries
- old compatibility shim modules for `operator_status`, `artifacts.health`,
  and `artifacts.snapshot` were removed after internal call sites moved to
  `forecast_etl.inspection`
- `cleanup-runs --delete --yes` remains outside inspection as an operator
  action that wraps read-only cleanup candidates
- CLI inspection workflows and backend health now import through the
  inspection boundary
- inspection tests guard against accidental dependencies on AWS adapters,
  source adapters, worker commands, and extraction modules
- public CLI output, backend health JSON, manifest schemas, artifact paths,
  shell-wrapper behavior, and Terraform behavior did not change

Backend-facing queries now have a clean Python home:

- current dataset/latest pointer status
- cycle current run
- run completeness and validation status
- recent cycles/runs
- cleanup candidates
- public data-manifest summary

### 7. Add Minimal Production Observability

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

### 8. Clean Up Tests By Layer

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

### 9. Clean Domain Modules Last

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

The backend should be designed on top of the inspection layer. The server
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
- no backend server before the inspection boundary is clear
- no deep rewrite of encoding/extraction math as part of workflow cleanup
- no further manifest schema churn after the Phase 2 dataset/frame cutover
- no cloud migration as part of the first refactor pass
- no broad cloud-neutral framework; keep portability at storage, execution,
  scheduling, and coordination boundaries

## Success Criteria

Already achieved:

- `run-cycle.sh`, `submit-cycle.sh`, GFS ingest, and ICON ingest all derive
  worker jobs from one shared planner/workflow path.
- Terraform exposes the ETL runtime contract clearly enough that scripts and
  Lambda configuration do not depend on incidental resource details.
- A cycle plan can represent local and AWS worker submissions, frame state,
  resume decisions, and optional publish/validate steps.
- Duplicate complete or actively claimed frame jobs are suppressed, while
  expired claims allow retry/resume and validation remains the publication gate.
- No public S3 layout, manifest schema, frontend payload resolution, or
  operator command contract changes should happen accidentally during the
  remaining behavior-preserving phases.

Still open:

- `cli.py` is small enough to scan quickly.
- Publish, validate, status, cleanup, and backfill each have clear module
  boundaries.
- Backend-readable state can be inspected without importing worker-heavy code.
- Production failures and stale public data produce low-noise alerts, while
  successful cycles remain quiet by default.
- Artifact storage can be swapped by URI/store adapter without changing worker,
  validator, publisher, or frontend manifest semantics.
- Tests are organized by behavior and remain green through file moves.
