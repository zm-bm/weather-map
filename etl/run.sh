#!/usr/bin/env bash
set -euo pipefail

# Unified entrypoint:
# - If invoked with a subcommand (plan/run/publish/worker), run it.
# - If invoked with worker-style flags (starting with '-'), assume "worker" for backward compat.
if [[ $# -eq 0 ]]; then
  exec python -u -m gfs_pipeline.cli --help
elif [[ "${1:-}" == -* ]]; then
  exec python -u -m gfs_pipeline.cli worker "$@"
else
  exec python -u -m gfs_pipeline.cli "$@"
fi
