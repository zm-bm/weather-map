#!/usr/bin/env bash
set -euo pipefail

python -u /app/etl/worker.py "$@"
