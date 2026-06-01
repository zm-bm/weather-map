resource "aws_s3_bucket" "artifacts" {
  bucket = local.artifacts_bucket_resource_name

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.tags, {
    Name = "weather-etl-artifacts-prod-bucket"
  })
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-field-payloads"
    status = "Enabled"

    filter {
      prefix = "fields/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "expire-status-markers"
    status = "Enabled"

    filter {
      prefix = "status/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "expire-etl-logs"
    status = "Enabled"

    filter {
      prefix = "logs/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "expire-runs"
    status = "Enabled"

    filter {
      prefix = "runs/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  rule {
    id     = "expire-manifests"
    status = "Enabled"

    filter {
      prefix = "manifests/"
    }

    expiration {
      days = 45
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.artifacts]
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    blocked_encryption_types = ["SSE-C"]

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket" "config" {
  bucket = local.config_bucket_resource_name

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(local.tags, {
    Name = "weather-etl-config-prod-bucket"
  })
}

resource "aws_s3_bucket_versioning" "config" {
  bucket = aws_s3_bucket.config.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "config" {
  bucket = aws_s3_bucket.config.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "config" {
  bucket = aws_s3_bucket.config.id

  rule {
    blocked_encryption_types = ["SSE-C"]

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_object" "forecast_config" {
  bucket       = local.config_bucket_name
  key          = local.pipeline_config_key
  source       = local.pipeline_config_path
  etag         = filemd5(local.pipeline_config_path)
  content_type = "application/json"
}

resource "aws_s3_object" "forecast_catalog" {
  bucket       = local.config_bucket_name
  key          = local.forecast_catalog_key
  source       = local.forecast_catalog_path
  etag         = filemd5(local.forecast_catalog_path)
  content_type = "application/json"
}
