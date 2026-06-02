"""Read-only operator command handlers for forecast-etl."""

from __future__ import annotations

import argparse

from ..workflows import inspection as inspection_workflow
from .arguments import require_dataset_id
from .context import app_context
from .formatting import print_operator_report


def cmd_runs(args: argparse.Namespace) -> int:
    """Inspect known runs for one dataset cycle."""

    report = inspection_workflow.runs(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
    )
    print_operator_report(report, as_json=bool(args.json))
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Inspect one run for one dataset cycle."""

    report = inspection_workflow.status(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle),
        run_id=args.run_id,
    )
    print_operator_report(report, as_json=bool(args.json))
    return 0


def cmd_pointers(args: argparse.Namespace) -> int:
    """Inspect public manifest pointers for one dataset."""

    report = inspection_workflow.pointers(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle) if args.cycle else None,
    )
    print_operator_report(report, as_json=bool(args.json))
    return 0


def cmd_cleanup_runs(args: argparse.Namespace) -> int:
    """Report or delete run cleanup candidates."""

    if args.delete and not args.yes:
        raise SystemExit("cleanup-runs --delete requires --yes")
    report = inspection_workflow.cleanup_runs(
        app_context=app_context(args),
        dataset_id=require_dataset_id(args),
        cycle=str(args.cycle) if args.cycle else None,
        delete_candidates=bool(args.delete),
    )
    print_operator_report(report, as_json=bool(args.json))
    return 2 if int(report.get("delete_error_count") or 0) else 0

