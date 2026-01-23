from typing import Protocol
from pathlib import Path

from paths import RepoPaths
from io_utils import run
from docker import docker_available, build_worker_image
from job import JobContext


class ExecutionBackend(Protocol):
    """Pluggable execution/publish backend (local docker, cloud batch, etc.)."""

    name: str
    paths: RepoPaths

    def prepare(self, *, skip_build: bool) -> None: ...
    def run_layer(self, *, ctx: JobContext) -> None: ...
    def sync_tiles(self) -> None: ...
    def sync_manifests(self, *, manifests_out: Path) -> None: ...
    def finalize(self, *, sync: bool, manifest: bool, manifests_out: Path | None = None) -> None: ...


class LocalDockerBackend:
    name = "local-docker"

    def __init__(self, *, paths: RepoPaths) -> None:
        self.paths = paths

    def prepare(self, *, skip_build: bool) -> None:
        docker_available()
        if not skip_build:
            build_worker_image(etl_dir=self.paths.etl_dir)

    def run_layer(self, *, ctx: JobContext) -> None:
        run(
            [
                "docker",
                "run",
                "--rm",
                "-v", f"{ctx.out_dir}:/out",
                "-v", f"{ctx.data_dir}:/data",
                "gfs-worker:dev",
                "--input", f"/data/{ctx.grib_relpath.as_posix()}",
                "--out", "/out/tiles",
                "--cycle", ctx.cycle,
                "--layer", ctx.layer,
                "--hour", ctx.fhr,
                "--min-zoom", str(ctx.min_zoom),
                "--max-zoom", str(ctx.max_zoom),
            ]
        )

    def sync_tiles(self) -> None:
        self.paths.backend_mbtiles.mkdir(parents=True, exist_ok=True)
        run(
            [
                "rsync",
                "-a",
                "--delete",
                f"{self.paths.etl_dir / 'out' / 'tiles'}/",
                f"{self.paths.backend_mbtiles}/",
            ]
        )

    def sync_manifests(self, *, manifests_out: Path) -> None:
        self.paths.frontend_manifests.mkdir(parents=True, exist_ok=True)
        run(["rsync", "-a", "--delete", f"{manifests_out}/", f"{self.paths.frontend_manifests}/"])

    def finalize(self, *, sync: bool, manifest: bool, manifests_out: Path | None = None) -> None:
        if sync:
            self.sync_tiles()
        if manifest:
            if manifests_out is None:
                raise ValueError("manifests_out is required when manifest=True")
            self.sync_manifests(manifests_out=manifests_out)


class CloudBackend:
    name = "cloud"

    def __init__(self, *, paths: RepoPaths) -> None:
        self.paths = paths

    def prepare(self, *, skip_build: bool) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def run_layer(self, *, ctx: JobContext) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def sync_tiles(self) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def sync_manifests(self, *, manifests_out: Path) -> None:
        raise SystemExit("Cloud backend not implemented yet.")

    def finalize(self, *, sync: bool, manifest: bool, manifests_out: Path | None = None) -> None:
        raise SystemExit("Cloud backend not implemented yet.")


def make_backend(name: str, *, paths: RepoPaths) -> ExecutionBackend:
    if name == "local-docker":
        return LocalDockerBackend(paths=paths)
    if name == "cloud":
        return CloudBackend(paths=paths)
    raise SystemExit(f"Unknown backend: {name}")
