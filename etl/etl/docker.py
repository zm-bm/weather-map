from pathlib import Path

from .io_utils import run


def docker_available() -> None:
    try:
        run(["docker", "version"], cwd=Path.cwd())
    except Exception as e:
        raise SystemExit("Docker is required to run the ETL worker.") from e


def build_worker_image(*, etl_dir: Path) -> None:
    run(
        [
            "docker",
            "build",
            "-t",
            "gfs-worker:dev",
            "-f",
            str(etl_dir / "Dockerfile"),
            str(etl_dir),
        ]
    )

