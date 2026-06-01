from __future__ import annotations

import unittest

from forecast_etl.manifest.pointers import (
    CURRENT_POINTER_SCHEMA,
    LATEST_POINTER_SCHEMA,
    manifest_pointer_dict,
    parse_manifest_pointer,
)
from forecast_etl.tests.fixtures.artifacts import DEFAULT_RUN_ID


class ManifestPointerTest(unittest.TestCase):
    def test_manifest_pointer_dict_preserves_stable_wire_shape(self) -> None:
        pointer = manifest_pointer_dict(
            schema_name=LATEST_POINTER_SCHEMA,
            model_id="gfs",
            cycle="2026053018",
            run_id=DEFAULT_RUN_ID,
            revision="abc123",
            generated_at="2026-05-31T01:22:33Z",
            manifest_path=f"manifests/gfs/cycles/2026053018/runs/{DEFAULT_RUN_ID}.json",
        )

        self.assertEqual(
            pointer,
            {
                "schema": "weather-map.model-latest-pointer",
                "schemaVersion": 1,
                "model": "gfs",
                "cycle": "2026053018",
                "runId": DEFAULT_RUN_ID,
                "revision": "abc123",
                "generatedAt": "2026-05-31T01:22:33Z",
                "manifestPath": f"manifests/gfs/cycles/2026053018/runs/{DEFAULT_RUN_ID}.json",
            },
        )
        parsed = parse_manifest_pointer(pointer, expected_schema=LATEST_POINTER_SCHEMA)
        self.assertEqual(parsed.cycle, "2026053018")
        self.assertEqual(parsed.run_id, DEFAULT_RUN_ID)

    def test_current_pointer_schema_is_accepted(self) -> None:
        pointer = manifest_pointer_dict(
            schema_name=CURRENT_POINTER_SCHEMA,
            model_id="gfs",
            cycle="2026053018",
            run_id=DEFAULT_RUN_ID,
            revision="abc123",
            generated_at="2026-05-31T01:22:33Z",
            manifest_path=f"manifests/gfs/cycles/2026053018/runs/{DEFAULT_RUN_ID}.json",
        )

        parsed = parse_manifest_pointer(pointer, expected_schema=CURRENT_POINTER_SCHEMA)

        self.assertEqual(parsed.schema_name, CURRENT_POINTER_SCHEMA)

    def test_parse_manifest_pointer_rejects_unsafe_paths_and_schema_mismatch(self) -> None:
        pointer = manifest_pointer_dict(
            schema_name=LATEST_POINTER_SCHEMA,
            model_id="gfs",
            cycle="2026053018",
            run_id=DEFAULT_RUN_ID,
            revision="abc123",
            generated_at="2026-05-31T01:22:33Z",
            manifest_path=f"manifests/gfs/cycles/2026053018/runs/{DEFAULT_RUN_ID}.json",
        )

        bad_path = dict(pointer)
        bad_path["manifestPath"] = "/manifests/gfs/latest.json"
        with self.assertRaises(SystemExit):
            parse_manifest_pointer(bad_path)

        with self.assertRaises(SystemExit):
            parse_manifest_pointer(pointer, expected_schema=CURRENT_POINTER_SCHEMA)


if __name__ == "__main__":
    unittest.main()
