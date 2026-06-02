from __future__ import annotations

import subprocess
import sys
import textwrap
import unittest


class InspectionBoundaryTest(unittest.TestCase):
    def test_inspection_modules_do_not_import_execution_or_processing_modules(self) -> None:
        code = textwrap.dedent(
            """
            import importlib
            import sys

            for name in (
                "forecast_etl.inspection.cleanup",
                "forecast_etl.inspection.data_manifest",
                "forecast_etl.inspection.health",
                "forecast_etl.inspection.pointers",
                "forecast_etl.inspection.runs",
                "forecast_etl.inspection.snapshot",
            ):
                importlib.import_module(name)

            forbidden = (
                "forecast_etl.aws",
                "forecast_etl.commands",
                "forecast_etl.encoding",
                "forecast_etl.extract",
                "forecast_etl.source_adapters",
                "forecast_etl.worker",
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
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
