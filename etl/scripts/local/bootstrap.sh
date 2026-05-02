#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ETL_DIR="$ROOT/etl"
VENV_DIR="$ETL_DIR/.venv"
HOST_PYTHON_BIN="${ETL_BOOTSTRAP_PYTHON:-python3}"
VENV_PYTHON_BIN="$VENV_DIR/bin/python"

if ! command -v "$HOST_PYTHON_BIN" >/dev/null 2>&1; then
	echo "Error: required command not found: $HOST_PYTHON_BIN" >&2
	exit 1
fi

if [[ ! -x "$VENV_PYTHON_BIN" ]]; then
	echo "Creating ETL virtual environment: $VENV_DIR"
	"$HOST_PYTHON_BIN" -m venv "$VENV_DIR"
fi

echo "Installing forecast_etl in editable mode"
"$VENV_PYTHON_BIN" -m pip install --upgrade pip "setuptools>=64"
"$VENV_PYTHON_BIN" -m pip install --no-build-isolation -e "$ETL_DIR[dev]"
