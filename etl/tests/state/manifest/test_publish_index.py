from __future__ import annotations

from unittest.mock import patch

import pytest
from weather_etl.state.manifest.index import publish_index

from tests.fixtures.artifact_configs import (
    minimal_artifact_config,
)
from tests.fixtures.publish import publish_fixture


def _tmp_artifacts_cfg() -> dict[str, dict]:
    return {"tmp_surface": minimal_artifact_config()}


def test_older_cycle_publish_does_not_rebuild_manifest_index() -> None:
    with publish_fixture(prefix="weather-map-publish-older-no-manifest-index-") as fx:
        cycle_old = "2026041100"
        cycle_new = "2026041200"
        scalar_artifacts = ("tmp_surface",)
        artifacts_cfg = _tmp_artifacts_cfg()
        product_config = fx.product_config_for(artifact_ids=scalar_artifacts, artifacts_cfg=artifacts_cfg)

        for cycle_value, base in ((cycle_new, 10.0), (cycle_old, -10.0)):
            fx.write_scalar_marker(
                cycle=cycle_value,
                artifact_id="tmp_surface",
                base=base,
                artifact_config=artifacts_cfg["tmp_surface"],
            )

        with patch(
            "weather_etl.state.manifest.public_view.publish_index",
            return_value="file:///manifest.json",
        ) as publish_index:
            result_new = fx.publish(
                cycle=cycle_new,
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
                product_config=product_config,
                publish_view=False,
            )
            view_new = fx.refresh_view(product_config=product_config, cycle=cycle_new)
            result_old = fx.publish(
                cycle=cycle_old,
                artifact_ids=scalar_artifacts,
                artifacts_cfg=artifacts_cfg,
                product_config=product_config,
                publish_view=False,
            )
            view_old = fx.refresh_view(product_config=product_config, cycle=cycle_old)

        assert result_new.ready
        assert result_old.ready
        assert view_new.published
        assert not view_old.published
        assert publish_index.call_count == 1


def test_publish_index_rejects_strict_dataset_malformed_latest_manifest() -> None:
    with publish_fixture(prefix="weather-map-publish-index-strict-latest-") as fx:
        artifact_id = "tmp_surface"
        artifact_cfg = minimal_artifact_config()
        product_config = fx.product_config_for(artifact_ids=(artifact_id,), artifacts_cfg={artifact_id: artifact_cfg})
        fx.store.write_bytes(uri=fx.ap.latest_manifest_uri(dataset_id=fx.dataset_id), data=b"{not-json")

        with pytest.raises(SystemExit, match="latest manifest for dataset 'gfs' is invalid"):
            publish_index(product_config=product_config, artifact_repo=fx.artifacts, strict_dataset_ids=(fx.dataset_id,))
