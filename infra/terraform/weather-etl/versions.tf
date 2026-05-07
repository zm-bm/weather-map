terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.43.0"
    }
    # Transitional: keep archive available until the next apply removes the
    # legacy data.archive_file.ingest_lambda instance from state.
    archive = {
      source  = "hashicorp/archive"
      version = "= 2.7.1"
    }
  }
}
