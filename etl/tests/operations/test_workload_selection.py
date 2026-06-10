from __future__ import annotations

import pytest
from weather_etl.operations.workload_selection import (
    WorkloadSelectionError,
    selected_workload_artifact_ids,
    selected_workload_frame_ids,
)


def test_selected_artifacts_preserve_workload_order_and_deduplicate(pipeline_config_factory) -> None:
    dataset = pipeline_config_factory(
        artifacts=("tmp_surface", "rh_surface", "wind10m_uv"),
    ).dataset("gfs")

    result = selected_workload_artifact_ids(dataset, ("wind10m_uv", "tmp_surface", "tmp_surface"))

    assert result == ("tmp_surface", "wind10m_uv")


def test_selected_artifacts_reject_blank_selection(pipeline_config_factory) -> None:
    dataset = pipeline_config_factory(artifacts=("tmp_surface",)).dataset("gfs")

    with pytest.raises(WorkloadSelectionError, match="artifact selection requires at least one non-empty artifact id"):
        selected_workload_artifact_ids(dataset, (" ", ""))


def test_selected_artifacts_reject_unknown_ids(pipeline_config_factory) -> None:
    dataset = pipeline_config_factory(artifacts=("tmp_surface",)).dataset("gfs")

    with pytest.raises(WorkloadSelectionError, match="Unknown artifact id"):
        selected_workload_artifact_ids(dataset, ("not_configured",))


def test_selected_frames_preserve_configured_order_and_reject_unknown() -> None:
    assert selected_workload_frame_ids(configured=("000", "003", "006"), selected=("006", "000")) == ("000", "006")

    with pytest.raises(WorkloadSelectionError, match="Unknown frame id"):
        selected_workload_frame_ids(configured=("000", "003"), selected=("009",))
