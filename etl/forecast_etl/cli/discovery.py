"""Small discovery and smoke command handlers for forecast-etl."""

from __future__ import annotations

import argparse

from .arguments import require_dataset_id
from .context import app_context


def cmd_list_frames(args: argparse.Namespace) -> int:
    """Print one configured frame id per line."""

    cfg = app_context(args).load_pipeline_config()
    dataset = cfg.dataset(require_dataset_id(args))
    for frame_id in dataset.workload.frames:
        print(frame_id)
    return 0


def cmd_list_datasets(args: argparse.Namespace) -> int:
    """Print one configured dataset id per line."""

    cfg = app_context(args).load_pipeline_config()
    for dataset_id in cfg.datasets:
        print(dataset_id)
    return 0


def cmd_smoke(args: argparse.Namespace) -> int:
    del args
    print("hello world")
    return 0

