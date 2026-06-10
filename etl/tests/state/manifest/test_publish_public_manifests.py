from __future__ import annotations

from tests.fixtures.artifact_configs import (
    minimal_artifact_config,
)
from tests.fixtures.publish import publish_fixture


def _tmp_artifacts_cfg() -> dict[str, dict]:
    return {"tmp_surface": minimal_artifact_config()}


def test_publish_does_not_promote_older_cycle_over_newer_latest() -> None:
    with publish_fixture(prefix="weather-map-publish-monotonic-") as fx:
        cycle_old = "2026041100"
        cycle_new = "2026041200"
        scalar_artifacts = ("tmp_surface",)
        artifacts_cfg = _tmp_artifacts_cfg()

        for cycle_value, base in ((cycle_new, 10.0), (cycle_old, -10.0)):
            fx.write_scalar_marker(
                cycle=cycle_value,
                artifact_id="tmp_surface",
                base=base,
                artifact_config=artifacts_cfg["tmp_surface"],
            )

        result_new = fx.publish(
            cycle=cycle_new,
            artifact_ids=scalar_artifacts,
            artifacts_cfg=artifacts_cfg,
        )
        assert result_new.ready
        assert result_new.latest_promoted

        result_old = fx.publish(
            cycle=cycle_old,
            artifact_ids=scalar_artifacts,
            artifacts_cfg=artifacts_cfg,
        )
        assert result_old.ready
        assert not result_old.latest_promoted

        latest_manifest = fx.latest_manifest()
        old_cycle_manifest = fx.cycle_manifest(cycle=cycle_old)
        new_cycle_manifest = fx.cycle_manifest(cycle=cycle_new)
        assert latest_manifest == new_cycle_manifest
        assert fx.current_manifest(cycle=cycle_old)["run"]["cycle"] == cycle_old
        assert fx.current_manifest(cycle=cycle_new)["run"]["cycle"] == cycle_new
        assert latest_manifest["run"]["cycle"] != old_cycle_manifest["run"]["cycle"]


def test_publish_can_repromote_previous_run_for_same_cycle() -> None:
    with publish_fixture(prefix="weather-map-publish-same-cycle-rollback-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        later_run_id = "20260411T010203Z-abcdef12"

        fx.write_scalar_marker(
            artifact_id=artifact_id,
            base=-10.0,
            artifact_config=artifact_cfg,
            run_id=fx.run_id,
        )
        result_first = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            run_id=fx.run_id,
        )
        assert result_first.ready
        first_revision = fx.latest_manifest()["run"]["revision"]

        fx.write_scalar_marker(
            artifact_id=artifact_id,
            base=10.0,
            artifact_config=artifact_cfg,
            run_id=later_run_id,
        )
        result_second = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            run_id=later_run_id,
        )
        assert result_second.ready
        assert fx.latest_manifest()["run"]["run_id"] == later_run_id
        assert fx.latest_manifest()["run"]["revision"] != first_revision

        result_rollback = fx.publish(
            artifact_ids=(artifact_id,),
            artifacts_cfg={artifact_id: artifact_cfg},
            run_id=fx.run_id,
        )

        assert result_rollback.ready
        assert result_rollback.already_published
        assert fx.latest_manifest()["run"]["run_id"] == fx.run_id
        assert fx.latest_manifest()["run"]["revision"] == first_revision
        assert fx.current_manifest()["run"]["run_id"] == fx.run_id

