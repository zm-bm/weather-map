from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ScriptHarness:
    repo_root: Path
    script: Path
    fake_bin_dir: Path
    env_defaults: dict[str, str] = field(default_factory=dict, kw_only=True)

    def write_executable(self, name: str, body: str) -> Path:
        path = self.fake_bin_dir / name
        path.write_text(body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return path

    def run(
        self,
        *args: str,
        env_overrides: dict[str, str] | None = None,
        check: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PATH"] = f"{self.fake_bin_dir}{os.pathsep}{env['PATH']}"
        env.update(self.env_defaults)
        if env_overrides is not None:
            env.update(env_overrides)
        return subprocess.run(
            [self.script.as_posix(), *args],
            cwd=self.repo_root,
            env=env,
            check=check,
            text=True,
            capture_output=True,
        )


@dataclass(frozen=True)
class LocalCycleScriptHarness(ScriptHarness):
    def current_image_source_fingerprint(self) -> str:
        relative_paths = [
            Path("config/catalog.json"),
            Path("config/pipeline.json"),
            Path("etl/Dockerfile"),
            Path("etl/pyproject.toml"),
        ]
        relative_paths.extend(
            path.relative_to(self.repo_root)
            for path in (self.repo_root / "etl" / "weather_etl").rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix != ".pyc"
        )

        sha256sum_lines = []
        for relative_path in sorted(relative_paths, key=lambda path: path.as_posix()):
            digest = hashlib.sha256((self.repo_root / relative_path).read_bytes()).hexdigest()
            sha256sum_lines.append(f"{digest}  {relative_path.as_posix()}\n")
        return hashlib.sha256("".join(sha256sum_lines).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class AwsCycleScriptHarness(ScriptHarness):
    fake_cli_log: Path
    fake_batch_log: Path

    def run(
        self,
        *args: str,
        submission_policy_status: int = 0,
        env_overrides: dict[str, str] | None = None,
        check: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        merged_overrides = {"FAKE_SUBMISSION_POLICY_STATUS": str(submission_policy_status)}
        if env_overrides is not None:
            merged_overrides.update(env_overrides)
        return super().run(*args, env_overrides=merged_overrides, check=check)

    def cli_log(self) -> str:
        return self.fake_cli_log.read_text(encoding="utf-8")

    def submitted_batch_jobs(self) -> list[dict]:
        jobs: list[dict] = []
        current: dict[str, object] = {}
        for line in self.fake_batch_log.read_text(encoding="utf-8").splitlines():
            key, value = line.split("=", 1)
            if key == "job_name":
                if current:
                    jobs.append(current)
                current = {"job_name": value}
            elif key == "container_overrides":
                current[key] = json.loads(value)
            else:
                current[key] = value
        if current:
            jobs.append(current)
        return jobs


def local_cycle_script_harness(repo_root: Path, tmp_path: Path) -> LocalCycleScriptHarness:
    harness = LocalCycleScriptHarness(
        repo_root=repo_root,
        script=repo_root / "scripts" / "etl-run-local.sh",
        fake_bin_dir=tmp_path,
    )
    harness.write_executable("docker", _FAKE_DOCKER)
    return harness


def aws_cycle_script_harness(repo_root: Path, tmp_path: Path) -> AwsCycleScriptHarness:
    cli_log = tmp_path / "cli.log"
    batch_log = tmp_path / "batch.log"
    harness = AwsCycleScriptHarness(
        repo_root=repo_root,
        script=repo_root / "scripts" / "etl-run-aws.sh",
        fake_bin_dir=tmp_path,
        env_defaults={
            "PYTHON_BIN": (tmp_path / "check-python").as_posix(),
            "FAKE_BATCH_LOG": batch_log.as_posix(),
        },
        fake_cli_log=cli_log,
        fake_batch_log=batch_log,
    )
    harness.write_executable("terraform", _FAKE_TERRAFORM)
    harness.write_executable("aws", _FAKE_AWS)
    harness.write_executable("check-python", _fake_python_bin(cli_log=cli_log, batch_log=batch_log))
    return harness


_FAKE_DOCKER = """#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
	if [[ -z "${FAKE_DOCKER_IMAGE_FINGERPRINT:-}" ]]; then
		exit 1
	fi
	printf "%s\\n" "$FAKE_DOCKER_IMAGE_FINGERPRINT"
	exit 0
fi

if [[ "${1:-}" == "build" ]]; then
	if [[ -n "${FAKE_DOCKER_LOG:-}" ]]; then
		printf "build" >> "$FAKE_DOCKER_LOG"
		for arg in "$@"; do
			printf " %q" "$arg" >> "$FAKE_DOCKER_LOG"
		done
		printf "\\n" >> "$FAKE_DOCKER_LOG"
	fi
	exit 0
fi

if [[ "${1:-}" == "run" ]]; then
	dataset_id=""
	frame_id=""
	cycle=""
	run_id=""
	mode=""
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--dataset-id)
				dataset_id="${2:-}"
				shift 2
				;;
			--env)
				case "${2:-}" in
					DATASET_ID=*) dataset_id="${2#DATASET_ID=}" ;;
					FRAME_ID=*) frame_id="${2#FRAME_ID=}" ;;
					CYCLE=*) cycle="${2#CYCLE=}" ;;
					RUN_ID=*) run_id="${2#RUN_ID=}" ;;
				esac
				shift 2
				;;
			list-frames|run-frame|publish-cycle|validate-cycle|init-run)
				mode="$1"
				shift
				;;
			*)
				shift
				;;
		esac
	done

	if [[ "$mode" == "run-frame" ]]; then
		if [[ -n "${FAKE_DOCKER_FAIL_FRAME:-}" && "$frame_id" == "$FAKE_DOCKER_FAIL_FRAME" ]]; then
			echo "simulated worker failure for frame_id=$frame_id" >&2
			exit 42
		fi
		echo "Done. Processed frame bundle cycle=${CYCLE:-unknown} frame_id=$frame_id: dataset_id=$dataset_id artifacts=18"
		exit 0
	fi

	if [[ "$mode" == "publish-cycle" ]]; then
		echo "Published: dataset_id=$dataset_id cycle=${CYCLE:-unknown}"
		exit 0
	fi

	if [[ "$mode" == "validate-cycle" ]]; then
		echo "Validation passed: dataset_id=$dataset_id cycle=$cycle"
		exit 0
	fi

	if [[ "$mode" == "init-run" ]]; then
		echo "run_id=$run_id"
		echo "product_config_digest=sha256:$(printf '%064d' 1)"
		echo "pipeline_uri=file:///artifacts/runs/$dataset_id/$cycle/$run_id/config/pipeline.json"
		echo "catalog_uri=file:///artifacts/runs/$dataset_id/$cycle/$run_id/config/catalog.json"
		exit 0
	fi

	case "$dataset_id" in
		gfs)
			start=0
			end=24
			;;
		icon)
			start=1
			end=24
			;;
		*)
			echo "unexpected dataset_id: $dataset_id" >&2
			exit 2
			;;
	esac

	for ((frame_id=start; frame_id<=end; frame_id++)); do
		printf "%03d\\n" "$frame_id"
	done
	exit 0
fi

echo "unexpected docker command: $*" >&2
exit 1
"""


_FAKE_TERRAFORM = """#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "output" || "${2:-}" != "-raw" ]]; then
  echo "unexpected terraform command: $*" >&2
  exit 1
fi

case "${3:-}" in
  batch_job_queue_name) echo "weather-etl" ;;
  batch_job_definition_arn) echo "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker:1" ;;
  icon_batch_job_definition_arn) echo "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker-icon:1" ;;
  pipeline_uri) echo "s3://config-bucket/pipeline.json" ;;
  catalog_uri) echo "s3://config-bucket/catalog.json" ;;
  artifact_root_uri) echo "s3://artifacts-bucket" ;;
  frame_claim_table_name) echo "frame-claims" ;;
  *)
    echo "unexpected terraform output: ${3:-}" >&2
    exit 1
    ;;
esac
"""


_FAKE_AWS = """#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "s3" && "${2:-}" == "cp" ]]; then
  dst="${4:-}"
  cat > "$dst" <<'JSON'
{
  "datasets": {
    "gfs": {
      "workload": {
        "frames": [0, 3],
        "artifacts": ["tmp_surface"]
      }
    },
    "icon": {
      "workload": {
        "frames": [1],
        "artifacts": ["tmp_surface"]
      }
    }
  }
}
JSON
  exit 0
fi

if [[ "${1:-}" == "batch" && "${2:-}" == "submit-job" ]]; then
  job_name=""
  job_queue=""
  job_definition=""
  container_overrides=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --job-name)
        job_name="${2:-}"
        shift 2
        ;;
      --job-queue)
        job_queue="${2:-}"
        shift 2
        ;;
      --job-definition)
        job_definition="${2:-}"
        shift 2
        ;;
      --container-overrides)
        container_overrides="${2:-}"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  {
    printf 'job_name=%s\\n' "$job_name"
    printf 'job_queue=%s\\n' "$job_queue"
    printf 'job_definition=%s\\n' "$job_definition"
    printf 'container_overrides=%s\\n' "$container_overrides"
  } >> "$FAKE_BATCH_LOG"
  printf 'job-%s\\n' "$job_name"
  exit 0
fi

echo "unexpected aws command: $*" >&2
exit 1
"""


def _fake_python_bin(*, cli_log: Path, batch_log: Path) -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail

printf "%s\\n" "$*" >> "{cli_log.as_posix()}"

if [[ "${{1:-}}" == "-m" && "${{2:-}}" == "weather_etl" && "${{3:-}}" == "submit-aws-cycle" ]]; then
  dataset_id="gfs"
  cycle=""
  run_id=""
  artifact_root_uri=""
  job_queue=""
  job_definition=""
  source_bucket="noaa-gfs-bdp-pds"
  dry_run="false"
  force_backfill="false"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dataset-id)
        dataset_id="${{2:-}}"
        shift 2
        ;;
      --cycle)
        cycle="${{2:-}}"
        shift 2
        ;;
      --run-id)
        run_id="${{2:-}}"
        shift 2
        ;;
      --artifact-root-uri)
        artifact_root_uri="${{2:-}}"
        shift 2
        ;;
      --job-queue)
        job_queue="${{2:-}}"
        shift 2
        ;;
      --job-definition)
        job_definition="${{2:-}}"
        shift 2
        ;;
      --source-bucket)
        source_bucket="${{2:-}}"
        shift 2
        ;;
      --dry-run)
        dry_run="true"
        shift
        ;;
      --force-backfill)
        force_backfill="true"
        shift
        ;;
      *)
        shift
        ;;
    esac
  done
  if [[ "${{FAKE_SUBMISSION_POLICY_STATUS:-0}}" != "0" ]]; then
    echo "Cycle submission policy check failed." >&2
    echo "allowed=false" >&2
    exit "$FAKE_SUBMISSION_POLICY_STATUS"
  fi
  echo "Cycle submission policy"
  echo "  force_backfill=$force_backfill"
  echo "Run snapshot"
  echo "  run_id=$run_id"
  echo "  product_config_digest=sha256:$(printf '%064d' 1)"
  echo "  pipeline_uri=${{artifact_root_uri%/}}/runs/$dataset_id/$cycle/$run_id/config/pipeline.json"
  echo "  catalog_uri=${{artifact_root_uri%/}}/runs/$dataset_id/$cycle/$run_id/config/catalog.json"
  echo "Cycle plan"
  if [[ "$dataset_id" == "icon" ]]; then
    frames=(001)
  else
    frames=(000 003)
  fi
  for frame_id in "${{frames[@]}}"; do
    echo "frame_id=$frame_id state=pending missing=0 errors=0"
    job_name="weather-etl-manual-$dataset_id-$cycle-$run_id-$frame_id-abcdef12"
    env_json="$(python3 - "$dataset_id" "$cycle" "$run_id" "$frame_id" "$artifact_root_uri" "$source_bucket" <<'PY'
import json
import sys
dataset_id, cycle, run_id, frame_id, artifact_root_uri, source_bucket = sys.argv[1:]
env = [
    {{"name": "ARTIFACT_ROOT_URI", "value": artifact_root_uri}},
    {{"name": "PIPELINE_URI", "value": f"{{artifact_root_uri}}/runs/{{dataset_id}}/{{cycle}}/{{run_id}}/config/pipeline.json"}},
    {{"name": "CATALOG_URI", "value": f"{{artifact_root_uri}}/runs/{{dataset_id}}/{{cycle}}/{{run_id}}/config/catalog.json"}},
    {{"name": "DATASET_ID", "value": dataset_id}},
    {{"name": "CYCLE", "value": cycle}},
    {{"name": "RUN_ID", "value": run_id}},
    {{"name": "FRAME_ID", "value": frame_id}},
]
if dataset_id == "gfs":
    env.append({{"name": "GRIB_SOURCE_URI", "value": f"s3://{{source_bucket}}/gfs.{{cycle[:8]}}/{{cycle[8:10]}}/atmos/gfs.t{{cycle[8:10]}}z.pgrb2.0p25.f{{frame_id}}"}})
print(json.dumps({{"environment": env}}, separators=(",", ":")))
PY
)"
    if [[ "$dry_run" == "true" ]]; then
      echo "  dry-run job_name=$job_name"
    else
      {{
        printf 'job_name=%s\\n' "$job_name"
        printf 'job_queue=%s\\n' "$job_queue"
        printf 'job_definition=%s\\n' "$job_definition"
        printf 'container_overrides=%s\\n' "$env_json"
      }} >> "{batch_log.as_posix()}"
      echo "  job_id=job-$job_name frame_id=$frame_id"
    fi
  done
  if [[ "$dry_run" == "true" ]]; then
    echo "Dry run complete."
  else
    echo "Submitted ${{#frames[@]}} Batch jobs."
    echo "The scheduled weather-etl-publisher Lambda will validate the run and publish manifests after all expected success markers exist."
  fi
  exit 0
fi

echo "unexpected python command: $*" >&2
exit 1
"""
