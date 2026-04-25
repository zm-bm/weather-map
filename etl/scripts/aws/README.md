# ETL AWS Scripts

This directory contains repo-local helper scripts for the existing `weather-etl`
AWS stack.

What lives here:

- shell helpers for building/pushing the ETL image
- shell helpers for invoking the existing Batch queue and ingest Lambda
- local event fixtures for testing the ingest Lambda

Canonical ETL application code now lives in:

- `etl/gfs_pipeline/aws/ingest.py`
- `etl/gfs_pipeline/cli.py`
- `etl/gfs.etl_config.json`

The ETL container now runs the Python CLI directly, with default command:

- `python -u -m gfs_pipeline.cli run-hour`

Terraform still lives in `/home/rick/code/infra/stacks/weather-etl` for now.

The AWS helper scripts in this directory talk to that Terraform stack by default
via:

- `TERRAFORM_DIR=/home/rick/code/infra/stacks/weather-etl`

Override `TERRAFORM_DIR` if you want them to target a different stack checkout.
