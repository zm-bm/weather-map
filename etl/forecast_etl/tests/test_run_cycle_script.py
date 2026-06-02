from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


class RunCycleScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo_root = Path(__file__).resolve().parents[3]
        self.script = self.repo_root / "etl" / "scripts" / "run-cycle.sh"
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.fake_bin_dir = Path(self.temp_dir.name)
        self._write_fake_docker()

    def _write_fake_docker(self) -> None:
        docker = self.fake_bin_dir / "docker"
        docker.write_text(
            """#!/usr/bin/env bash
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
\texit 0
fi

if [[ "${1:-}" == "run" ]]; then
\tmodel=""
\tfhour=""
\tcycle=""
\trun_id=""
\tmode=""
\twhile [[ $# -gt 0 ]]; do
\t\tcase "$1" in
\t\t\t--model)
\t\t\t\tmodel="${2:-}"
\t\t\t\tshift 2
\t\t\t\t;;
\t\t\t--env)
\t\t\t\tcase "${2:-}" in
\t\t\t\t\tMODEL=*) model="${2#MODEL=}" ;;
\t\t\t\t\tFHOUR=*) fhour="${2#FHOUR=}" ;;
\t\t\t\t\tCYCLE=*) cycle="${2#CYCLE=}" ;;
\t\t\t\t\tRUN_ID=*) run_id="${2#RUN_ID=}" ;;
\t\t\t\tesac
\t\t\t\tshift 2
\t\t\t\t;;
\t\t\tlist-forecast-hours|run-hour|publish-cycle|validate-cycle|init-run)
\t\t\t\tmode="$1"
\t\t\t\tshift
\t\t\t\t;;
\t\t\t*)
\t\t\t\tshift
\t\t\t\t;;
\t\tesac
\tdone

\tif [[ "$mode" == "run-hour" ]]; then
\t\tif [[ -n "${FAKE_DOCKER_FAIL_FHOUR:-}" && "$fhour" == "$FAKE_DOCKER_FAIL_FHOUR" ]]; then
\t\t\techo "simulated worker failure for fhour=$fhour" >&2
\t\t\texit 42
\t\tfi
\t\techo "Done. Processed fhour bundle cycle=${CYCLE:-unknown} fhour=$fhour: model=$model artifacts=18"
\t\texit 0
\tfi

\tif [[ "$mode" == "publish-cycle" ]]; then
\t\techo "Published: model=$model cycle=${CYCLE:-unknown}"
\t\texit 0
\tfi

\tif [[ "$mode" == "validate-cycle" ]]; then
\t\techo "Validation passed: model=$model cycle=${CYCLE:-unknown}"
\t\texit 0
\tfi

\tif [[ "$mode" == "init-run" ]]; then
\t\techo "run_id=$run_id"
\t\techo "config_digest=sha256:$(printf '%064d' 1)"
\t\techo "pipeline_config_uri=file:///artifacts/runs/$model/$cycle/$run_id/config/pipeline_config.json"
\t\techo "forecast_catalog_uri=file:///artifacts/runs/$model/$cycle/$run_id/config/forecast_catalog.json"
\t\texit 0
\tfi

\tcase "$model" in
\t\tgfs)
\t\t\tstart=0
\t\t\tend=24
\t\t\t;;
\t\ticon)
\t\t\tstart=1
\t\t\tend=24
\t\t\t;;
\t\t*)
\t\t\techo "unexpected model: $model" >&2
\t\t\texit 2
\t\t\t;;
\tesac

\tfor ((fhour=start; fhour<=end; fhour++)); do
\t\tprintf "%03d\\n" "$fhour"
\tdone
\texit 0
fi

echo "unexpected docker command: $*" >&2
exit 1
""",
            encoding="utf-8",
        )
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR)

    def current_image_source_fingerprint(self) -> str:
        relative_paths = [
            Path("config/forecast_catalog.json"),
            Path("config/pipeline/base.json"),
            Path("config/pipeline/local.json"),
            Path("etl/Dockerfile"),
            Path("etl/pyproject.toml"),
        ]
        relative_paths.extend(
            path.relative_to(self.repo_root)
            for path in (self.repo_root / "etl" / "forecast_etl").rglob("*")
            if path.is_file()
            and "__pycache__" not in path.parts
            and path.suffix != ".pyc"
        )

        sha256sum_lines = []
        for relative_path in sorted(relative_paths, key=lambda path: path.as_posix()):
            digest = hashlib.sha256((self.repo_root / relative_path).read_bytes()).hexdigest()
            sha256sum_lines.append(f"{digest}  {relative_path.as_posix()}\n")
        return hashlib.sha256("".join(sha256sum_lines).encode("utf-8")).hexdigest()

    def run_script(
        self,
        *args: str,
        env_overrides: dict[str, str] | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["PATH"] = f"{self.fake_bin_dir}{os.pathsep}{env['PATH']}"
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

    def test_icon_dry_run_uses_one_worker_container_per_configured_hour(self) -> None:
        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026021606",
            "--run-id",
            DEFAULT_RUN_ID,
            "--dry-run",
        )

        self.assertIn("forecast_hours: 24", result.stdout)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local run-hour"), 24)
        self.assertIn("--volume " + (self.repo_root / "artifacts").as_posix() + ":/artifacts", result.stdout)
        self.assertIn("--volume " + (self.repo_root / "etl" / "cache").as_posix() + ":/app/etl/cache", result.stdout)
        self.assertIn("--env ARTIFACT_ROOT_URI=file:///artifacts", result.stdout)
        self.assertIn(
            f"--env PIPELINE_CONFIG_URI=file:///artifacts/runs/icon/2026021606/{DEFAULT_RUN_ID}/config/pipeline_config.json",
            result.stdout,
        )
        self.assertIn(
            f"--env FORECAST_CATALOG_URI=file:///artifacts/runs/icon/2026021606/{DEFAULT_RUN_ID}/config/forecast_catalog.json",
            result.stdout,
        )
        self.assertNotIn("--env PIPELINE_CONFIG_OVERLAY_URI", result.stdout)
        self.assertIn("--env MODEL=icon", result.stdout)
        self.assertIn(f"--env RUN_ID={DEFAULT_RUN_ID}", result.stdout)
        self.assertIn("--env FHOUR=001", result.stdout)
        self.assertIn("--env FHOUR=024", result.stdout)
        self.assertNotIn("GRIB_SOURCE_URI", result.stdout)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local init-run"), 1)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local validate-cycle"), 1)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local publish-cycle"), 1)

    def test_no_publish_skips_final_publish_container(self) -> None:
        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026021606",
            "--run-id",
            DEFAULT_RUN_ID,
            "--no-publish",
            "--dry-run",
        )

        self.assertIn("forecast_hours: 24", result.stdout)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local run-hour"), 24)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local validate-cycle"), 1)
        self.assertNotIn("weather-map-forecast-etl:local publish-cycle", result.stdout)

    def test_dry_run_without_run_id_generates_one_shared_run_id(self) -> None:
        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026021606",
            "--dry-run",
        )

        run_ids = re.findall(r"--env RUN_ID=([0-9]{8}T[0-9]{6}Z-[0-9a-f]{8})", result.stdout)
        self.assertTrue(run_ids)
        self.assertEqual(len(set(run_ids)), 1)
        run_id = run_ids[0]
        self.assertEqual(result.stdout.count(f"--env RUN_ID={run_id}"), 27)
        self.assertIn(f"--run-id {run_id}", result.stdout)
        self.assertIn(
            f"pipeline_config_uri: file:///artifacts/runs/icon/2026021606/{run_id}/config/pipeline_config.json",
            result.stdout,
        )
        self.assertIn(
            f"forecast_catalog_uri: file:///artifacts/runs/icon/2026021606/{run_id}/config/forecast_catalog.json",
            result.stdout,
        )
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local init-run"), 1)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local run-hour"), 24)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local validate-cycle"), 1)
        self.assertEqual(result.stdout.count("weather-map-forecast-etl:local publish-cycle"), 1)

    def test_dry_run_reuses_current_worker_image_without_rebuilding(self) -> None:
        docker_log = self.fake_bin_dir / "docker.log"

        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026021606",
            "--run-id",
            DEFAULT_RUN_ID,
            "--dry-run",
            env_overrides={
                "FAKE_DOCKER_IMAGE_FINGERPRINT": self.current_image_source_fingerprint(),
                "FAKE_DOCKER_LOG": docker_log.as_posix(),
            },
        )

        self.assertIn("Worker image is current; skipping rebuild.", result.stdout)
        self.assertFalse(docker_log.exists())

    def test_stale_worker_image_rebuilds_with_source_fingerprint_label(self) -> None:
        docker_log = self.fake_bin_dir / "docker.log"

        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026021606",
            "--run-id",
            DEFAULT_RUN_ID,
            "--dry-run",
            env_overrides={
                "FAKE_DOCKER_IMAGE_FINGERPRINT": "stale",
                "FAKE_DOCKER_LOG": docker_log.as_posix(),
            },
        )

        self.assertIn("Building worker image (ETL image inputs changed).", result.stdout)
        self.assertIn(
            "--label "
            + "org.zmbm.weather-map.forecast-etl.source-fingerprint="
            + self.current_image_source_fingerprint(),
            docker_log.read_text(encoding="utf-8"),
        )

    def test_gfs_dry_run_resolves_configured_hours(self) -> None:
        result = self.run_script(
            "--model",
            "gfs",
            "--cycle",
            "2026051100",
            "--run-id",
            DEFAULT_RUN_ID,
            "--dry-run",
        )

        self.assertIn("forecast_hours: 25", result.stdout)
        self.assertIn("--env MODEL=gfs", result.stdout)
        self.assertIn(f"--env RUN_ID={DEFAULT_RUN_ID}", result.stdout)
        self.assertIn("--env FHOUR=000", result.stdout)
        self.assertIn("--env FHOUR=024", result.stdout)

    def test_parallel_run_prints_failed_worker_log_tail(self) -> None:
        result = self.run_script(
            "--model",
            "icon",
            "--cycle",
            "2026021606",
            "--procs",
            "4",
            env_overrides={
                "ETL_WORKER_STAGGER_SECONDS": "0",
                "FAKE_DOCKER_FAIL_FHOUR": "003",
            },
            check=False,
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("worker_logs:", result.stdout)
        self.assertIn("Failed local worker containers:", result.stderr)
        self.assertIn("model=icon cycle=2026021606 fhour=003 exit=42", result.stderr)
        self.assertIn("simulated worker failure for fhour=003", result.stderr)

    def test_script_no_longer_checks_host_gdal_or_cdo(self) -> None:
        script_text = self.script.read_text(encoding="utf-8")

        self.assertNotIn("gdalinfo", script_text)
        self.assertNotIn("gdal_translate", script_text)
        self.assertNotIn("gdalwarp", script_text)
        self.assertNotIn("command -v cdo", script_text)
        self.assertNotIn("bootstrap_if_needed", script_text)
        self.assertNotIn("FORECAST_ETL_BIN", script_text)

    def test_script_uses_cli_to_resolve_forecast_hours(self) -> None:
        script_text = self.script.read_text(encoding="utf-8")

        self.assertIn("list-forecast-hours", script_text)
        self.assertIn('--volume "$ARTIFACTS_DIR:/artifacts"', script_text)
        self.assertNotIn("import json", script_text)
        self.assertNotIn("python3 -", script_text)
        self.assertNotIn("docker run -i --rm --entrypoint python", script_text)


if __name__ == "__main__":
    unittest.main()
