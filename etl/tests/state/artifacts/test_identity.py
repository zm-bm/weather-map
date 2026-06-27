from __future__ import annotations

import pytest
from weather_etl.state.artifacts.identity import ArtifactWorkItem

from tests.fixtures.artifacts import DEFAULT_PRODUCT_CONFIG_DIGEST, DEFAULT_RUN_ID


def test_artifact_work_item_accepts_generic_safe_frame_ids() -> None:
    item = ArtifactWorkItem(
        dataset_id=" radar ",
        cycle="2026041200",
        run_id=DEFAULT_RUN_ID,
        frame_id="radar-20260412T001500Z",
        artifact_id=" sample_artifact ",
        source_uri="file:///dev/null",
        code_revision="  abc   def  ",
        image_identity="",
        product_config_digest=DEFAULT_PRODUCT_CONFIG_DIGEST,
    )

    assert item.dataset_id == "radar"
    assert item.frame_id == "radar-20260412T001500Z"
    assert item.artifact_id == "sample_artifact"
    assert item.code_revision == "abc def"
    assert item.image_identity == "unknown"
    assert item.product_config_digest == DEFAULT_PRODUCT_CONFIG_DIGEST


@pytest.mark.parametrize("value", [None, "", "unknown", "digest", "sha256:" + "z" * 64])
def test_artifact_work_item_rejects_invalid_product_config_digest(value: object) -> None:
    with pytest.raises(ValueError):
        ArtifactWorkItem(
            dataset_id="radar",
            cycle="2026041200",
            run_id=DEFAULT_RUN_ID,
            frame_id="radar-20260412T001500Z",
            artifact_id="sample_artifact",
            source_uri="file:///dev/null",
            product_config_digest=value,
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"dataset_id": "../radar"},
        {"artifact_id": "bad/artifact"},
        {"frame_id": "../bad"},
    ],
)
def test_artifact_work_item_rejects_unsafe_path_segments(overrides: dict[str, str]) -> None:
    values = {
        "dataset_id": "radar",
        "cycle": "2026041200",
        "run_id": DEFAULT_RUN_ID,
        "frame_id": "radar-20260412T001500Z",
        "artifact_id": "sample_artifact",
        "source_uri": "file:///dev/null",
        "product_config_digest": DEFAULT_PRODUCT_CONFIG_DIGEST,
        **overrides,
    }

    with pytest.raises(ValueError):
        ArtifactWorkItem(**values)
