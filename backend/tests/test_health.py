from __future__ import annotations

import ast
import json
from datetime import datetime, timezone
from pathlib import Path

from weather_map_backend.health import build_health
from weather_map_backend.settings import Settings, load_settings
from weather_map_backend.status_document import read_status_document

NOW = datetime(2026, 5, 11, 18, 30, tzinfo=timezone.utc)
STATUS_GENERATED_AT = "2026-05-11T18:00:00Z"


def test_health_formats_published_status_document(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _write_status(settings, _status_document(datasets=(_dataset("gfs", status="fresh"), _building_dataset("icon"))))

    health = build_health(settings, now=NOW)

    assert health["schema"] == "weather-map.health"
    assert health["schema_version"] == 2
    assert health["generated_at"] == STATUS_GENERATED_AT
    assert health["status"] == "degraded"
    assert health["datasets"][0]["status"] == "fresh"
    assert health["datasets"][0]["progress"] is None
    assert health["datasets"][1] == {
        "dataset_id": "icon",
        "label": "ICON",
        "status": "building",
        "reason": "Expected cycle is still building.",
        "expected_cycle": "2026051112",
        "expected_cycle_deadline": "2026-05-11T15:00:00Z",
        "latest_observed_cycle": "2026051112",
        "latest_published_cycle": "2026051106",
        "latest_published_generated_at": "2026-05-11T07:00:00Z",
        "lifecycle_stage": "pending_frames",
        "lifecycle_cycle": "2026051112",
        "lifecycle_run_id": "20260511T183000Z-abcdef12",
        "progress": {
            "cycle": "2026051112",
            "run_id": "20260511T183000Z-abcdef12",
            "run_count": 1,
            "published": False,
            "expected_markers": 4,
            "found_markers": 2,
            "missing_markers": 2,
            "last_progress_at": "2026-05-11T18:30:00Z",
            "missing_sample": ["tmp_surface/002"],
            "invalid_marker_sample": [],
        },
        "publish_lag": {
            "grace_hours": 3.46,
            "source": "recent-history",
        },
    }


def test_health_reports_healthy_when_all_status_datasets_are_fresh(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    _write_status(settings, _status_document(datasets=(_dataset("gfs", status="fresh"), _dataset("icon", status="fresh"))))

    health = build_health(settings, now=NOW)

    assert health["status"] == "healthy"
    assert {dataset["status"] for dataset in health["datasets"]} == {"fresh"}


def test_health_reports_unavailable_when_status_document_is_missing(tmp_path: Path) -> None:
    settings = _settings(tmp_path)

    health = build_health(settings, now=NOW)

    assert health["generated_at"] == "2026-05-11T18:30:00Z"
    assert health["status"] == "unavailable"
    assert [dataset["dataset_id"] for dataset in health["datasets"]] == ["gfs", "icon"]
    assert all(dataset["status"] == "unavailable" for dataset in health["datasets"])
    assert all(dataset["progress"] is None for dataset in health["datasets"])
    assert all(dataset["lifecycle_stage"] is None for dataset in health["datasets"])
    assert all(dataset["lifecycle_cycle"] is None for dataset in health["datasets"])
    assert all(dataset["lifecycle_run_id"] is None for dataset in health["datasets"])
    assert all(dataset["reason"].startswith("Unable to read ETL status:") for dataset in health["datasets"])


def test_health_reports_unavailable_when_status_document_is_malformed(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    root = Path(settings.artifact_root_uri.removeprefix("file://"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "status.json").write_text('{"schema": "wrong"}', encoding="utf-8")

    health = build_health(settings, now=NOW)

    assert health["status"] == "unavailable"
    assert all("Invalid ETL status document" in dataset["reason"] for dataset in health["datasets"])


def test_load_settings_reads_only_artifact_root(monkeypatch) -> None:
    monkeypatch.setenv("ARTIFACT_ROOT_URI", "file:///tmp/artifacts")

    settings = load_settings()

    assert settings == Settings(artifact_root_uri="file:///tmp/artifacts")


def test_status_document_reader_supports_s3_uri() -> None:
    document = _status_document(datasets=(_dataset("gfs", status="fresh"),))
    s3_client = _FakeS3Client({("bucket", "artifacts/status.json"): json.dumps(document).encode("utf-8")})

    assert read_status_document(artifact_root_uri="s3://bucket/artifacts", s3_client=s3_client) == document
    assert s3_client.requests == [("bucket", "artifacts/status.json")]


def test_backend_package_does_not_import_weather_etl() -> None:
    package_root = Path(__file__).resolve().parents[1] / "weather_map_backend"
    offenders: list[str] = []
    for path in package_root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            if any(name == "weather_etl" or name.startswith("weather_etl.") for name in names):
                offenders.append(path.relative_to(package_root).as_posix())

    assert offenders == []


def _settings(tmp_path: Path) -> Settings:
    return Settings(artifact_root_uri=(tmp_path / "artifacts").as_uri())


def _write_status(settings: Settings, document: dict) -> None:
    root = Path(settings.artifact_root_uri.removeprefix("file://"))
    root.mkdir(parents=True, exist_ok=True)
    (root / "status.json").write_text(json.dumps(document, sort_keys=True) + "\n", encoding="utf-8")


def _status_document(*, datasets: tuple[dict, ...]) -> dict:
    bad_dataset_count = sum(1 for dataset in datasets if dataset["bad_state"])
    return {
        "schema": "weather-map.etl-status",
        "schema_version": 1,
        "generated_at": STATUS_GENERATED_AT,
        "ok": bad_dataset_count == 0,
        "artifact_root_uri": "file:///tmp/artifacts",
        "product_config_digest": "sha256:" + "0" * 64,
        "config_error": None,
        "dataset_count": len(datasets),
        "bad_dataset_count": bad_dataset_count,
        "inspection_failure_count": 0,
        "datasets": list(datasets),
        "manifest_index": {
            "status": "valid",
            "valid": True,
            "path": "manifests/index.json",
            "generated_at": STATUS_GENERATED_AT,
            "dataset_count": len(datasets),
            "latest_dataset_count": len(datasets),
            "diagnostics": [],
        },
    }


def _dataset(dataset_id: str, *, status: str) -> dict:
    return {
        "dataset_id": dataset_id,
        "label": dataset_id.upper(),
        "status": status,
        "bad_state": status not in {"fresh", "building"},
        "reason": "Latest expected cycle is published.",
        "expected_cycle": "2026051112",
        "expected_cycle_deadline": "2026-05-11T15:00:00Z",
        "latest_observed_cycle": "2026051112",
        "latest_published_cycle": "2026051112",
        "latest_published_generated_at": "2026-05-11T14:00:00Z",
        "latest_cycle_lag_hours": 0.0,
        "lifecycle_stage": "published",
        "lifecycle_cycle": "2026051112",
        "lifecycle_run_id": "20260511T183000Z-abcdef12",
        "progress": None,
        "publish_lag": {
            "grace_hours": 3.46,
            "source": "recent-history",
        },
    }


def _building_dataset(dataset_id: str) -> dict:
    dataset = _dataset(dataset_id, status="building")
    dataset.update(
        {
            "reason": "Expected cycle is still building.",
            "latest_published_cycle": "2026051106",
            "latest_published_generated_at": "2026-05-11T07:00:00Z",
            "latest_cycle_lag_hours": 6.0,
            "lifecycle_stage": "pending_frames",
            "progress": {
                "cycle": "2026051112",
                "run_id": "20260511T183000Z-abcdef12",
                "run_count": 1,
                "published": False,
                "manifest_present": False,
                "expected_markers": 4,
                "found_markers": 2,
                "missing_markers": 2,
                "last_progress_at": "2026-05-11T18:30:00Z",
                "missing_sample": ["tmp_surface/002"],
                "invalid_marker_sample": [],
            },
        }
    )
    return dataset


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeS3Client:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = objects
        self.requests: list[tuple[str, str]] = []

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        self.requests.append((Bucket, Key))
        return {"Body": _FakeBody(self.objects[(Bucket, Key)])}
