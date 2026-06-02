from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


class SubmitCycleScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[3]
        self.script = self.repo_root / "infra" / "scripts" / "weather-etl" / "ops" / "submit-cycle.sh"
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.fake_bin_dir = Path(self.temp_dir.name)
        self.fake_check_log = self.fake_bin_dir / "check-backfill.log"
        self.fake_batch_log = self.fake_bin_dir / "batch.log"
        self._write_fake_terraform()
        self._write_fake_aws()
        self._write_fake_python_bin()

    def _write_fake_terraform(self) -> None:
        terraform = self.fake_bin_dir / "terraform"
        terraform.write_text(
            """#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "output" || "${2:-}" != "-raw" ]]; then
  echo "unexpected terraform command: $*" >&2
  exit 1
fi

case "${3:-}" in
  batch_job_queue_name) echo "weather-etl" ;;
  batch_job_definition_arn) echo "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker:1" ;;
  icon_batch_job_definition_arn) echo "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker-icon:1" ;;
  pipeline_config_uri) echo "s3://config-bucket/pipeline.json" ;;
  forecast_catalog_uri) echo "s3://config-bucket/forecast_catalog.json" ;;
  artifacts_bucket_name) echo "artifacts-bucket" ;;
  *)
    echo "unexpected terraform output: ${3:-}" >&2
    exit 1
    ;;
esac
""",
            encoding="utf-8",
        )
        terraform.chmod(terraform.stat().st_mode | stat.S_IXUSR)

    def _write_fake_aws(self) -> None:
        aws = self.fake_bin_dir / "aws"
        aws.write_text(
            """#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "s3" && "${2:-}" == "cp" ]]; then
  dst="${4:-}"
  cat > "$dst" <<'JSON'
{
  "models": {
    "gfs": {
      "workload": {
        "forecast_hours": [0, 3],
        "artifacts": ["tmp_surface"]
      }
    },
    "icon": {
      "workload": {
        "forecast_hours": [1],
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
""",
            encoding="utf-8",
        )
        aws.chmod(aws.stat().st_mode | stat.S_IXUSR)

    def _write_fake_python_bin(self) -> None:
        check_python = self.fake_bin_dir / "check-python"
        check_python.write_text(
            f"""#!/usr/bin/env bash
set -euo pipefail

printf "%s\\n" "$*" >> "{self.fake_check_log.as_posix()}"

if [[ "${{1:-}}" == "-m" && "${{2:-}}" == "forecast_etl.cli" && "${{3:-}}" == "check-backfill" ]]; then
  echo "model=gfs"
  echo "cycle=2026051100"
  echo "latest_status=valid"
  echo "latest_cycle=2026051106"
  echo "backfill_required=true"
  if [[ "$*" == *"--backfill"* ]]; then
    echo "backfill_allowed=true"
  else
    echo "backfill_allowed=false"
  fi
  if [[ "${{FAKE_BACKFILL_STATUS:-0}}" == "0" ]]; then
    echo "ok=true"
    echo "message=allowed"
    exit 0
  fi
  echo "ok=false"
  echo "message=blocked"
  exit "$FAKE_BACKFILL_STATUS"
fi

if [[ "${{1:-}}" == "-m" && "${{2:-}}" == "forecast_etl.cli" && "${{3:-}}" == "init-run" ]]; then
  model=""
  cycle=""
  run_id=""
  artifact_root_uri=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model)
        model="${{2:-}}"
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
      *)
        shift
        ;;
    esac
  done
  echo "run_id=$run_id"
  echo "config_digest=sha256:$(printf '%064d' 1)"
  echo "pipeline_config_uri=${{artifact_root_uri%/}}/runs/$model/$cycle/$run_id/config/pipeline_config.json"
  echo "forecast_catalog_uri=${{artifact_root_uri%/}}/runs/$model/$cycle/$run_id/config/forecast_catalog.json"
  exit 0
fi

echo "unexpected python command: $*" >&2
exit 1
""",
            encoding="utf-8",
        )
        check_python.chmod(check_python.stat().st_mode | stat.S_IXUSR)

    def run_script(self, *args: str, backfill_status: int = 0) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PATH"] = f"{self.fake_bin_dir}{os.pathsep}{env['PATH']}"
        env["PYTHON_BIN"] = (self.fake_bin_dir / "check-python").as_posix()
        env["FAKE_BACKFILL_STATUS"] = str(backfill_status)
        env["FAKE_BATCH_LOG"] = self.fake_batch_log.as_posix()
        return subprocess.run(
            [self.script.as_posix(), *args],
            cwd=self.repo_root,
            env=env,
            check=False,
            text=True,
            capture_output=True,
        )

    def test_older_cycle_blocks_without_backfill_flag(self) -> None:
        result = self.run_script(
            "--cycle",
            "2026051100",
            "--dry-run",
            "--skip-config-check",
            backfill_status=2,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("Backfill safety check failed.", result.stderr)
        self.assertIn("ok=false", result.stderr)
        self.assertNotIn("Run snapshot", result.stdout)
        self.assertNotIn("dry-run job_name", result.stdout)
        self.assertIn("check-backfill", self.fake_check_log.read_text(encoding="utf-8"))

    def test_backfill_flag_allows_dry_run(self) -> None:
        result = self.run_script(
            "--cycle",
            "2026051100",
            "--backfill",
            "--dry-run",
            "--skip-config-check",
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("backfill:            true", result.stdout)
        self.assertIn("Backfill safety", result.stdout)
        self.assertIn("backfill_allowed=true", result.stdout)
        self.assertIn("Run snapshot", result.stdout)
        self.assertIn("dry-run job_name", result.stdout)
        self.assertIn("--backfill", self.fake_check_log.read_text(encoding="utf-8"))

    def test_dry_run_shows_backfill_check_before_snapshot_and_jobs(self) -> None:
        result = self.run_script(
            "--cycle",
            "2026051100",
            "--run-id",
            DEFAULT_RUN_ID,
            "--dry-run",
            "--skip-config-check",
        )

        self.assertEqual(result.returncode, 0)
        self.assertLess(result.stdout.index("Backfill safety"), result.stdout.index("Run snapshot"))
        self.assertLess(result.stdout.index("Run snapshot"), result.stdout.index("dry-run job_name"))
        self.assertIn("source_config_uri:   s3://config-bucket/pipeline.json", result.stdout)
        self.assertIn("source_catalog_uri:  s3://config-bucket/forecast_catalog.json", result.stdout)
        self.assertIn(
            f"pipeline_config_uri=s3://artifacts-bucket/runs/gfs/2026051100/{DEFAULT_RUN_ID}/config/pipeline_config.json",
            result.stdout,
        )
        self.assertIn(
            f"forecast_catalog_uri=s3://artifacts-bucket/runs/gfs/2026051100/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
            result.stdout,
        )
        self.assertEqual(result.stdout.count("dry-run job_name"), 2)
        self.assertIn("check-backfill", self.fake_check_log.read_text(encoding="utf-8"))

    def test_submit_uses_one_snapshot_and_run_scoped_batch_env(self) -> None:
        result = self.run_script(
            "--cycle",
            "2026051100",
            "--run-id",
            DEFAULT_RUN_ID,
            "--skip-config-check",
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("Submitted 2 Batch jobs.", result.stdout)
        self.assertIn(
            "The scheduled weather-etl-publisher Lambda will validate the run and publish manifests",
            result.stdout,
        )
        cli_log = self.fake_check_log.read_text(encoding="utf-8")
        self.assertLess(cli_log.index("check-backfill"), cli_log.index("init-run"))
        self.assertEqual(cli_log.count(" init-run "), 1)

        jobs = self._read_batch_jobs()
        self.assertEqual(len(jobs), 2)
        for expected_fhour, job in zip(("000", "003"), jobs, strict=True):
            self.assertIn(f"weather-etl-manual-gfs-2026051100-{DEFAULT_RUN_ID}-{expected_fhour}", job["job_name"])
            self.assertEqual(job["job_queue"], "weather-etl")
            self.assertEqual(job["job_definition"], "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker:1")
            env = {item["name"]: item["value"] for item in job["container_overrides"]["environment"]}
            self.assertEqual(env["MODEL"], "gfs")
            self.assertEqual(env["CYCLE"], "2026051100")
            self.assertEqual(env["RUN_ID"], DEFAULT_RUN_ID)
            self.assertEqual(env["FHOUR"], expected_fhour)
            self.assertEqual(
                env["PIPELINE_CONFIG_URI"],
                f"s3://artifacts-bucket/runs/gfs/2026051100/{DEFAULT_RUN_ID}/config/pipeline_config.json",
            )
            self.assertEqual(
                env["FORECAST_CATALOG_URI"],
                f"s3://artifacts-bucket/runs/gfs/2026051100/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
            )
            self.assertEqual(
                env["GRIB_SOURCE_URI"],
                f"s3://noaa-gfs-bdp-pds/gfs.20260511/00/atmos/gfs.t00z.pgrb2.0p25.f{expected_fhour}",
            )

    def test_icon_submit_uses_icon_job_definition_and_no_grib_source_env(self) -> None:
        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026051100",
            "--run-id",
            DEFAULT_RUN_ID,
            "--skip-config-check",
        )

        self.assertEqual(result.returncode, 0)
        jobs = self._read_batch_jobs()
        self.assertEqual(len(jobs), 1)
        job = jobs[0]
        self.assertIn(f"weather-etl-manual-icon-2026051100-{DEFAULT_RUN_ID}-001", job["job_name"])
        self.assertEqual(
            job["job_definition"],
            "arn:aws:batch:us-east-1:123:job-definition/weather-etl-worker-icon:1",
        )
        env = {item["name"]: item["value"] for item in job["container_overrides"]["environment"]}
        self.assertEqual(env["MODEL"], "icon")
        self.assertEqual(env["FHOUR"], "001")
        self.assertNotIn("GRIB_SOURCE_URI", env)
        self.assertEqual(
            env["PIPELINE_CONFIG_URI"],
            f"s3://artifacts-bucket/runs/icon/2026051100/{DEFAULT_RUN_ID}/config/pipeline_config.json",
        )

    def _read_batch_jobs(self) -> list[dict]:
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


if __name__ == "__main__":
    unittest.main()
