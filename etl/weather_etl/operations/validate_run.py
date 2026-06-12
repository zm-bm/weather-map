"""Validate one processed run."""

from __future__ import annotations

from dataclasses import dataclass

from ..core.cycles import parse_cycle
from ..environment import EtlEnvironment
from ..state.runs.ids import parse_run_id
from ..state.runs.snapshots import select_run_id_for_cycle
from ..state.runs.validation import RunValidationResult
from ..state.runs.validation import validate_run as validate_processed_run


@dataclass(frozen=True)
class ValidateRunResult:
    ready: bool
    passed: bool
    run_id: str | None
    message: str | None = None
    errors: tuple[str, ...] = ()
    validation_result: RunValidationResult | None = None


def validate_run(
    *,
    env: EtlEnvironment,
    dataset_id: str,
    cycle: str,
    required_run_id: str | None = None,
) -> ValidateRunResult:
    parse_cycle(cycle)
    parsed_required_run_id = parse_run_id(required_run_id) if required_run_id else None
    run_id, run_errors = select_run_id_for_cycle(
        artifact_repo=env.artifact_repo,
        dataset_id=dataset_id,
        cycle=cycle,
        required_run_id=parsed_required_run_id,
    )
    if run_errors or run_id is None:
        return ValidateRunResult(
            ready=False,
            passed=False,
            run_id=run_id,
            message=f"run selection failed for dataset_id={dataset_id} cycle={cycle}",
            errors=tuple(run_errors),
        )

    try:
        snapshot = env.load_run_snapshot(dataset_id=dataset_id, cycle=cycle, run_id=run_id)
    except FileNotFoundError as exc:
        return ValidateRunResult(
            ready=False,
            passed=False,
            run_id=run_id,
            message=str(exc),
        )

    dataset = snapshot.dataset(dataset_id)
    result = validate_processed_run(
        artifact_repo=env.artifact_repo,
        dataset=dataset,
        cycle=cycle,
        run_id=run_id,
        snapshot=snapshot,
    )
    return ValidateRunResult(
        ready=True,
        passed=result.passed,
        run_id=run_id,
        validation_result=result,
        errors=tuple(result.errors),
    )
