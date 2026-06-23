from __future__ import annotations

import subprocess
import sys
import textwrap


class TestInspectionBoundary:
    def test_inspection_modules_do_not_import_execution_or_processing_modules(self) -> None:
        code = textwrap.dedent(
            """
            import importlib
            import sys

            for name in (
                "weather_etl.state.inspection.freshness",
                "weather_etl.state.inspection.lifecycle",
                "weather_etl.state.inspection.manifest_index",
                "weather_etl.state.inspection.status_document",
            ):
                importlib.import_module(name)

            forbidden = (
                "weather_etl.adapters.aws",
                "weather_etl.processing",
                "weather_etl.sources",
            )
            loaded = sorted(
                name
                for name in sys.modules
                if any(name == prefix or name.startswith(prefix + ".") for prefix in forbidden)
            )
            if loaded:
                raise SystemExit("\\n".join(loaded))
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            check=False,
            text=True,
            capture_output=True,
        )
        assert result.returncode == 0, result.stderr or result.stdout
