resource "aws_s3_bucket" "artifacts" {
  bucket        = local.artifacts_bucket_resource_name
  force_destroy = true

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-artifacts-${local.environment}-bucket"
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
    id     = "expire-runs"
    status = "Enabled"

    filter {
      prefix = "runs/"
    }

    expiration {
      days = var.run_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
    }
  }

  rule {
    id     = "expire-manifests"
    status = "Enabled"

    filter {
      prefix = "manifests/"
    }

    expiration {
      days = var.manifest_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_retention_days
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
  bucket        = local.config_bucket_resource_name
  force_destroy = true

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-config-${local.environment}-bucket"
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

resource "aws_s3_object" "pipeline" {
  bucket       = local.config_bucket_name
  key          = local.pipeline_key
  source       = local.pipeline_path
  etag         = filemd5(local.pipeline_path)
  content_type = "application/json"
}

resource "aws_s3_object" "catalog" {
  bucket       = local.config_bucket_name
  key          = local.catalog_key
  source       = local.catalog_path
  etag         = filemd5(local.catalog_path)
  content_type = "application/json"
}
