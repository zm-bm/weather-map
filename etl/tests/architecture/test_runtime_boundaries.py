from __future__ import annotations

import ast
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = PROJECT_ROOT / "weather_etl"

BOUNDARY_RULES = (
    (
        "config",
        (
            "weather_etl.adapters.aws",
            "weather_etl.adapters.cli",
            "weather_etl.environment",
            "weather_etl.operations",
            "weather_etl.processing",
            "weather_etl.sources",
            "weather_etl.state.artifacts",
            "weather_etl.state.inspection",
            "weather_etl.state.manifest",
            "weather_etl.state.runs",
            "weather_etl.workers",
        ),
    ),
    (
        "environment",
        (
            "weather_etl.processing",
            "weather_etl.sources",
        ),
    ),
    (
        "operations",
        (
            "weather_etl.adapters.aws",
            "weather_etl.adapters.cli",
        ),
    ),
    (
        "adapters/cli",
        (
            "weather_etl.processing",
            "weather_etl.sources",
            "weather_etl.state.inspection",
            "weather_etl.state.manifest.artifact_entry",
            "weather_etl.state.manifest.build",
            "weather_etl.state.manifest.publish",
            "weather_etl.state.manifest.publish_gate",
            "weather_etl.state.manifest.publish_markers",
            "weather_etl.workers",
        ),
    ),
    (
        "adapters/aws",
        (
            "weather_etl.adapters.cli",
            "weather_etl.processing",
            "weather_etl.state.manifest.artifact_entry",
            "weather_etl.state.manifest.build",
            "weather_etl.state.manifest.publish",
            "weather_etl.state.manifest.publish_gate",
            "weather_etl.state.manifest.publish_markers",
            "weather_etl.workers",
        ),
    ),
    (
        "workers",
        (
            "weather_etl.adapters.aws",
            "weather_etl.adapters.cli",
            "weather_etl.operations",
            "weather_etl.processing",
            "weather_etl.sources",
            "weather_etl.state.artifacts",
            "weather_etl.state.manifest",
            "weather_etl.state.runs",
            "weather_etl.storage",
        ),
    ),
)

def _internal_imports(package: str) -> dict[str, set[str]]:
    imports_by_file: dict[str, set[str]] = {}
    package_root = PACKAGE_ROOT / package
    assert package_root.exists(), f"package path does not exist: {package_root}"
    for path in sorted(package_root.rglob("*.py")):
        rel = path.relative_to(PACKAGE_ROOT)
        tree = ast.parse(path.read_text(), filename=str(path))
        imports: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names if alias.name.startswith("weather_etl."))
            elif isinstance(node, ast.ImportFrom):
                imports.update(_resolve_from_import(rel=rel, node=node))
        if imports:
            imports_by_file[rel.as_posix()] = imports
    return imports_by_file


def _resolve_from_import(*, rel: Path, node: ast.ImportFrom) -> set[str]:
    if node.level == 0:
        module = node.module or ""
        return {module} if module.startswith("weather_etl.") else set()

    current_package = rel.with_suffix("").parts[:-1]
    base_parts = current_package[: -(node.level - 1)] if node.level > 1 else current_package
    modules: set[str] = set()
    if node.module:
        modules.add("weather_etl." + ".".join([*base_parts, node.module]))
    else:
        modules.add("weather_etl." + ".".join(base_parts))
        modules.update(
            "weather_etl." + ".".join([*base_parts, alias.name]) for alias in node.names if alias.name != "*"
        )
    return modules


def _violations(
    package: str,
    forbidden_prefixes: tuple[str, ...],
) -> dict[str, list[str]]:
    violations: dict[str, list[str]] = {}
    for rel, imports in _internal_imports(package).items():
        matches = sorted(
            imported
            for imported in imports
            if any(imported == prefix or imported.startswith(prefix + ".") for prefix in forbidden_prefixes)
        )
        if matches:
            violations[rel] = matches
    return violations


class TestRuntimeBoundaryContract:
    @pytest.mark.parametrize(("package", "forbidden_prefixes"), BOUNDARY_RULES)
    def test_runtime_boundaries(self, package: str, forbidden_prefixes: tuple[str, ...]) -> None:
        assert _violations(package, forbidden_prefixes) == {}

    def test_private_config_helpers_do_not_leave_config_package(self) -> None:
        violations: dict[str, list[str]] = {}
        for package_path in sorted(PACKAGE_ROOT.iterdir()):
            if not package_path.is_dir() or package_path.name in {"__pycache__", "config"}:
                continue
            for rel, imports in _internal_imports(package_path.name).items():
                matches = sorted(imported for imported in imports if imported.startswith("weather_etl.config._"))
                if matches:
                    violations[rel] = matches

        assert violations == {}

    def test_submit_aws_run_does_not_import_validation_or_publish_runtime(self) -> None:
        imports = _internal_imports("operations").get("operations/submit_aws_run.py", set())
        forbidden = (
            "weather_etl.operations.publish_run",
            "weather_etl.state.manifest.publish",
            "weather_etl.state.runs.validation",
        )
        assert (
            sorted(
                imported
                for imported in imports
                if any(imported == prefix or imported.startswith(prefix + ".") for prefix in forbidden)
            )
            == []
        )
