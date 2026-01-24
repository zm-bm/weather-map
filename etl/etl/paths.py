from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RepoPaths:
    repo_root: Path
    etl_dir: Path
    data_dir: Path
    out_dir: Path
    backend_mbtiles: Path
    frontend_manifests: Path


def repo_paths() -> RepoPaths:
    repo_root: Path | None = None
    for p in Path(__file__).resolve().parents:
        if (p / "etl").is_dir() and (p / "backend").exists() and (p / "frontend").exists():
            repo_root = p
            break
    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]

    etl_dir = repo_root / "etl"
    return RepoPaths(
        repo_root=repo_root,
        etl_dir=etl_dir,
        data_dir=etl_dir / "data",
        out_dir=etl_dir / "out",
        backend_mbtiles=repo_root / "backend" / "data" / "mbtiles",
        frontend_manifests=repo_root / "frontend" / "public" / "manifests",
    )

