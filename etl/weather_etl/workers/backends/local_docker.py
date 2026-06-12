"""Local Docker job command mechanics."""

from __future__ import annotations

import os
import shlex
import subprocess
import time
from collections.abc import Mapping
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path

from ..launch import (
    WorkerLaunchRecord,
    WorkerLaunchRequest,
)
from ..spec import FrameWorkerSpec


@dataclass(frozen=True)
class LocalDockerWorkerBackend:
    """Local Docker backend for launching planned frame workers."""

    local_image: str
    artifacts_dir: Path
    cache_dir: Path
    procs: int
    worker_stagger_seconds: float

    def launch_many(
        self,
        requests: tuple[WorkerLaunchRequest, ...],
        *,
        dry_run: bool,
    ) -> tuple[WorkerLaunchRecord, ...]:
        if dry_run:
            return tuple(self._dry_run_request(request) for request in requests)
        return self._run_requests(requests)

    def _dry_run_request(self, request: WorkerLaunchRequest) -> WorkerLaunchRecord:
        run_or_print(self._worker_cmd(request.worker), dry_run=True)
        return WorkerLaunchRecord(
            worker=request.worker,
            source_uri=request.source_uri,
            started=False,
            attempt=request.attempt,
        )

    def _run_requests(self, requests: tuple[WorkerLaunchRequest, ...]) -> tuple[WorkerLaunchRecord, ...]:
        results: list[WorkerLaunchRecord | None] = [None] * len(requests)
        active: set[Future[int]] = set()
        future_indexes: dict[Future[int], int] = {}
        with ThreadPoolExecutor(max_workers=max(1, self.procs)) as executor:
            for index, request in enumerate(requests):
                if index > 0 and self.worker_stagger_seconds:
                    time.sleep(self.worker_stagger_seconds)
                future = executor.submit(run_command, self._worker_cmd(request.worker))
                active.add(future)
                future_indexes[future] = index
                if len(active) >= max(1, self.procs):
                    done, active = wait(active, return_when=FIRST_COMPLETED)
                    for completed in done:
                        request = requests[future_indexes[completed]]
                        returncode = completed.result()
                        results[future_indexes[completed]] = _worker_record(
                            request=request,
                            returncode=returncode,
                        )
            while active:
                done, active = wait(active, return_when=FIRST_COMPLETED)
                for completed in done:
                    request = requests[future_indexes[completed]]
                    returncode = completed.result()
                    results[future_indexes[completed]] = _worker_record(
                        request=request,
                        returncode=returncode,
                    )
        return tuple(record for record in results if record is not None)

    def _worker_cmd(self, worker: FrameWorkerSpec) -> list[str]:
        return worker_container_cmd(
            local_image=self.local_image,
            artifacts_dir=self.artifacts_dir,
            cache_dir=self.cache_dir,
            worker=worker,
        )


def _worker_record(*, request: WorkerLaunchRequest, returncode: int) -> WorkerLaunchRecord:
    return WorkerLaunchRecord(
        worker=request.worker,
        source_uri=request.source_uri,
        started=returncode == 0,
        failed=returncode != 0,
        attempt=request.attempt,
    )


def worker_container_cmd(
    *,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path,
    worker: FrameWorkerSpec,
) -> list[str]:
    env = {
        str(key): container_uri(str(value), artifacts_dir=artifacts_dir) for key, value in worker.env.items()
    }
    return local_container_cmd(
        local_image=local_image,
        artifacts_dir=artifacts_dir,
        cache_dir=cache_dir,
        extra_mounts=None,
        env=env,
        command=list(worker.command[1:]),
    )


def local_container_cmd(
    *,
    local_image: str,
    artifacts_dir: Path,
    cache_dir: Path | None,
    extra_mounts: Mapping[Path, str] | None = None,
    env: Mapping[str, str],
    command: list[str],
) -> list[str]:
    cmd = [
        "docker",
        "run",
        "--rm",
        "--network",
        "host",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--volume",
        f"{artifacts_dir.as_posix()}:/artifacts",
    ]
    if cache_dir is not None:
        cmd.extend(["--volume", f"{cache_dir.as_posix()}:/app/etl/cache"])
    if extra_mounts:
        for host_path, container_path in sorted(extra_mounts.items(), key=lambda item: item[1]):
            cmd.extend(["--volume", f"{host_path.as_posix()}:{container_path}:ro"])
    merged_env = dict(env)
    for metadata_env in ("ETL_CODE_REVISION", "ETL_IMAGE_IDENTITY"):
        value = os.environ.get(metadata_env)
        if value:
            merged_env.setdefault(metadata_env, value)
    for key, value in merged_env.items():
        cmd.extend(["--env", f"{key}={value}"])
    cmd.extend(["--env", "PYTHONDONTWRITEBYTECODE=1", local_image, *command])
    return cmd


def run_or_print(cmd: list[str], *, dry_run: bool) -> int:
    if dry_run:
        print("dry-run: " + shlex.join(cmd), flush=True)
        return 0
    return run_command(cmd)


def run_command(cmd: list[str]) -> int:
    return subprocess.run(cmd, check=False).returncode


def container_uri(
    value: str,
    *,
    artifacts_dir: Path,
    extra_mounts: Mapping[Path, str] | None = None,
) -> str:
    mount_points: dict[Path, str] = {artifacts_dir.resolve(): "/artifacts"}
    if extra_mounts:
        mount_points.update({path.resolve(): container_path for path, container_path in extra_mounts.items()})
    for host_root, container_root in mount_points.items():
        host_prefix = host_root.as_uri()
        container_prefix = _file_uri(Path(container_root))
        if value == host_prefix:
            return container_prefix
        if value.startswith(host_prefix + "/"):
            return container_prefix.rstrip("/") + "/" + value[len(host_prefix) + 1 :]
    return value


def _file_uri(path: Path) -> str:
    return Path(path).expanduser().resolve().as_uri()
