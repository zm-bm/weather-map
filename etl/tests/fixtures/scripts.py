from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

ETL_BASE_FINGERPRINT_LABEL = "org.zmbm.weather-map.weather-etl.base-fingerprint"
ETL_APP_FINGERPRINT_LABEL = "org.zmbm.weather-map.weather-etl.app-fingerprint"


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
        input_text: str | None = None,
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
            input=input_text,
        )


@dataclass(frozen=True)
class EtlImageScriptHarness(ScriptHarness):
    def current_base_image_source_fingerprint(self) -> str:
        return self._fingerprint_paths([Path("etl/Dockerfile.base")])

    def current_app_image_source_fingerprint(self) -> str:
        relative_paths = [
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
        return self._fingerprint_paths(relative_paths)

    def image_labels_json(self, image_labels: dict[str, dict[str, str]]) -> str:
        return json.dumps(image_labels, sort_keys=True)

    def _fingerprint_paths(self, relative_paths: list[Path]) -> str:
        sha256sum_lines = []
        for relative_path in sorted(relative_paths, key=lambda path: path.as_posix()):
            digest = hashlib.sha256((self.repo_root / relative_path).read_bytes()).hexdigest()
            sha256sum_lines.append(f"{digest}  {relative_path.as_posix()}\n")
        return hashlib.sha256("".join(sha256sum_lines).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class DeployScriptHarness(EtlImageScriptHarness):
    fake_docker_log: Path
    fake_aws_log: Path
    fake_terraform_log: Path
    fake_command_log: Path

    def docker_log(self) -> str:
        if not self.fake_docker_log.exists():
            return ""
        return self.fake_docker_log.read_text(encoding="utf-8")

    def aws_log(self) -> str:
        if not self.fake_aws_log.exists():
            return ""
        return self.fake_aws_log.read_text(encoding="utf-8")

    def terraform_log(self) -> str:
        if not self.fake_terraform_log.exists():
            return ""
        return self.fake_terraform_log.read_text(encoding="utf-8")

    def command_log(self) -> str:
        if not self.fake_command_log.exists():
            return ""
        return self.fake_command_log.read_text(encoding="utf-8")


@dataclass(frozen=True)
class AwsRunScriptHarness(ScriptHarness):
    fake_cli_log: Path
    fake_batch_log: Path

    def run(
        self,
        *args: str,
        env_overrides: dict[str, str] | None = None,
        input_text: str | None = None,
        check: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        return super().run(*args, env_overrides=env_overrides, input_text=input_text, check=check)

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


@dataclass(frozen=True)
class SyncArtifactsScriptHarness(ScriptHarness):
    fake_aws_log: Path

    def aws_log(self) -> str:
        return self.fake_aws_log.read_text(encoding="utf-8")


def sync_artifacts_script_harness(repo_root: Path, tmp_path: Path) -> SyncArtifactsScriptHarness:
    aws_log = tmp_path / "aws.log"
    harness = SyncArtifactsScriptHarness(
        repo_root=repo_root,
        script=repo_root / "scripts" / "etl-sync-artifacts.sh",
        fake_bin_dir=tmp_path,
        env_defaults={"FAKE_AWS_LOG": aws_log.as_posix()},
        fake_aws_log=aws_log,
    )
    harness.write_executable("aws", _FAKE_AWS)
    return harness


def aws_run_script_harness(repo_root: Path, tmp_path: Path) -> AwsRunScriptHarness:
    cli_log = tmp_path / "cli.log"
    batch_log = tmp_path / "batch.log"
    harness = AwsRunScriptHarness(
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


def deploy_script_harness(repo_root: Path, tmp_path: Path) -> DeployScriptHarness:
    docker_log = tmp_path / "docker.log"
    aws_log = tmp_path / "aws.log"
    terraform_log = tmp_path / "terraform.log"
    command_log = tmp_path / "command.log"
    harness = DeployScriptHarness(
        repo_root=repo_root,
        script=repo_root / "scripts" / "etl-deploy.sh",
        fake_bin_dir=tmp_path,
        env_defaults={
            "FAKE_DOCKER_LOG": docker_log.as_posix(),
            "FAKE_AWS_LOG": aws_log.as_posix(),
            "FAKE_TERRAFORM_LOG": terraform_log.as_posix(),
            "FAKE_COMMAND_LOG": command_log.as_posix(),
            "PYTHON_BIN": (tmp_path / "python3.12").as_posix(),
            "DIST_DIR": (tmp_path / "dist").as_posix(),
        },
        fake_docker_log=docker_log,
        fake_aws_log=aws_log,
        fake_terraform_log=terraform_log,
        fake_command_log=command_log,
    )
    harness.write_executable("docker", _FAKE_DOCKER)
    harness.write_executable("aws", _FAKE_AWS)
    harness.write_executable("terraform", _FAKE_TERRAFORM)
    harness.write_executable("python3.12", _FAKE_LAMBDA_BUILD_PYTHON)
    harness.write_executable("zip", _FAKE_ZIP)
    return harness


_FAKE_DOCKER = """#!/usr/bin/env bash
set -euo pipefail

log_command() {
	if [[ -n "${FAKE_COMMAND_LOG:-}" ]]; then
		printf "docker" >> "$FAKE_COMMAND_LOG"
		for arg in "$@"; do
			printf " %q" "$arg" >> "$FAKE_COMMAND_LOG"
		done
		printf "\\n" >> "$FAKE_COMMAND_LOG"
	fi
	if [[ -n "${FAKE_DOCKER_LOG:-}" ]]; then
		printf "%s" "$1" >> "$FAKE_DOCKER_LOG"
		shift
		for arg in "$@"; do
			printf " %q" "$arg" >> "$FAKE_DOCKER_LOG"
		done
		printf "\\n" >> "$FAKE_DOCKER_LOG"
	fi
}

if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
	format="${4:-}"
	image="${5:-}"
	label="${format#*\\"}"
	label="${label%%\\"*}"
	if [[ -n "${FAKE_DOCKER_IMAGE_LABELS_JSON:-}" ]]; then
		python3 - "$image" "$label" <<'PY'
import json
import os
import sys

image = sys.argv[1]
label = sys.argv[2]
labels = json.loads(os.environ["FAKE_DOCKER_IMAGE_LABELS_JSON"])
if image not in labels:
    raise SystemExit(1)
value = labels[image].get(label, "<no value>")
print(value)
PY
		exit $?
	fi
	if [[ -n "${FAKE_DOCKER_IMAGE_FINGERPRINT:-}" ]]; then
		printf "%s\\n" "$FAKE_DOCKER_IMAGE_FINGERPRINT"
		exit 0
	fi
	exit 1
fi

if [[ "${1:-}" == "build" ]]; then
	log_command "$@"
	exit 0
fi

if [[ "${1:-}" == "tag" ]]; then
	log_command "$@"
	exit 0
fi

if [[ "${1:-}" == "push" ]]; then
	log_command "$@"
	exit 0
fi

if [[ "${1:-}" == "login" ]]; then
	log_command "$@"
	cat >/dev/null || true
	exit 0
fi

echo "unexpected docker command: $*" >&2
exit 1
"""


_FAKE_TERRAFORM = """#!/usr/bin/env bash
set -euo pipefail

log_command_all() {
  if [[ -n "${FAKE_COMMAND_LOG:-}" ]]; then
    printf "terraform" >> "$FAKE_COMMAND_LOG"
    for arg in "$@"; do
      printf " %q" "$arg" >> "$FAKE_COMMAND_LOG"
    done
    printf "\\n" >> "$FAKE_COMMAND_LOG"
  fi
  if [[ -n "${FAKE_TERRAFORM_LOG:-}" ]]; then
    printf "%s" "$1" >> "$FAKE_TERRAFORM_LOG"
    shift
    for arg in "$@"; do
      printf " %q" "$arg" >> "$FAKE_TERRAFORM_LOG"
    done
    printf "\\n" >> "$FAKE_TERRAFORM_LOG"
  fi
}

if [[ "${1:-}" == -chdir=* ]]; then
  shift
fi

log_command_all "$@"

case "${1:-}" in
  init|validate|plan)
    exit 0
    ;;
  apply)
    exit 0
    ;;
esac

if [[ "${1:-}" == "output" && "${2:-}" == "etl_runtime_contract" ]]; then
  echo '{"artifact_root_uri":"s3://artifacts-bucket"}'
  exit 0
fi

if [[ "${1:-}" != "output" || "${2:-}" != "-raw" ]]; then
  echo "unexpected terraform command: $*" >&2
  exit 1
fi

case "${3:-}" in
  worker_ecr_repository_url) echo "123456789012.dkr.ecr.us-east-1.amazonaws.com/weather-etl-worker" ;;
  artifacts_bucket_name) echo "artifacts-bucket" ;;
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

log_command() {
  if [[ -n "${FAKE_COMMAND_LOG:-}" ]]; then
    printf "aws" >> "$FAKE_COMMAND_LOG"
    for arg in "$@"; do
      printf " %q" "$arg" >> "$FAKE_COMMAND_LOG"
    done
    printf "\\n" >> "$FAKE_COMMAND_LOG"
  fi
  if [[ -n "${FAKE_AWS_LOG:-}" ]]; then
    printf "%s" "$1" >> "$FAKE_AWS_LOG"
    shift
    for arg in "$@"; do
      printf " %q" "$arg" >> "$FAKE_AWS_LOG"
    done
    printf "\\n" >> "$FAKE_AWS_LOG"
  fi
}

log_command "$@"

if [[ "${1:-}" == "sts" && "${2:-}" == "get-caller-identity" ]]; then
  echo "${FAKE_AWS_ACCOUNT_ID:-123456789012}"
  exit 0
fi

if [[ "${1:-}" == "ecr" && "${2:-}" == "describe-repositories" ]]; then
  if [[ "${FAKE_AWS_ECR_REPO_EXISTS:-true}" == "true" ]]; then
    echo '{"repositories":[{"repositoryName":"weather-etl-worker"}]}'
    exit 0
  fi
  exit 254
fi

if [[ "${1:-}" == "ecr" && "${2:-}" == "create-repository" ]]; then
  echo '{"repository":{"repositoryName":"weather-etl-worker"}}'
  exit 0
fi

if [[ "${1:-}" == "ecr" && "${2:-}" == "get-login-password" ]]; then
  echo "fake-password"
  exit 0
fi

if [[ "${1:-}" == "s3" && "${2:-}" == "sync" ]]; then
  exit 0
fi

if [[ "${1:-}" == "s3" && "${2:-}" == "cp" ]]; then
  src="${3:-}"
  dst="${4:-}"
  if [[ "$src" == s3://* && "$dst" != s3://* ]]; then
    if [[ -n "${FAKE_AWS_OBJECTS_JSON:-}" ]]; then
      python3 - "$src" "$dst" <<'PY'
import json
import os
import sys
from pathlib import Path

src = sys.argv[1]
dst = Path(sys.argv[2])
objects = json.loads(os.environ["FAKE_AWS_OBJECTS_JSON"])
if src not in objects:
    raise SystemExit(f"missing fake S3 object: {src}")
value = objects[src]
text = value if isinstance(value, str) else json.dumps(value)
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(text, encoding="utf-8")
PY
      exit $?
    fi
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
  fi
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


_FAKE_LAMBDA_BUILD_PYTHON = """#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-c" ]]; then
  echo "3.12"
  exit 0
fi

if [[ "${1:-}" == "-m" && "${2:-}" == "venv" ]]; then
  venv_dir="${3:-}"
  mkdir -p "$venv_dir/bin"
  cat > "$venv_dir/bin/python" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "-m" && "${2:-}" == "pip" ]]; then
  exit 0
fi
echo "unexpected fake build venv python command: $*" >&2
exit 1
SH
  chmod +x "$venv_dir/bin/python"
  exit 0
fi

echo "unexpected fake lambda build python command: $*" >&2
exit 1
"""


_FAKE_ZIP = """#!/usr/bin/env bash
set -euo pipefail

target=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -*) shift ;;
    *)
      target="$1"
      break
      ;;
  esac
done
if [[ -z "$target" ]]; then
  echo "missing fake zip target" >&2
  exit 1
fi
printf "fake zip payload\\n" > "$target"
"""


def _fake_python_bin(*, cli_log: Path, batch_log: Path) -> str:
    return f"""#!/usr/bin/env bash
set -euo pipefail

printf "%s\\n" "$*" >> "{cli_log.as_posix()}"

if [[ "${{1:-}}" == "-m" && "${{2:-}}" == "weather_etl" && "${{3:-}}" == "submit-aws-run" ]]; then
  dataset_id="gfs"
  cycle=""
  run_id=""
  artifact_root_uri=""
  job_queue=""
  job_definition=""
  source_bucket="noaa-gfs-bdp-pds"
  dry_run="false"
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
      *)
        shift
        ;;
    esac
  done
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
