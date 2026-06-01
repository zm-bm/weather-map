from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path


class SubmitCycleScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[3]
        self.script = self.repo_root / "infra" / "scripts" / "weather-etl" / "ops" / "submit-cycle.sh"
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.fake_bin_dir = Path(self.temp_dir.name)
        self.fake_check_log = self.fake_bin_dir / "check-backfill.log"
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


if __name__ == "__main__":
    unittest.main()
