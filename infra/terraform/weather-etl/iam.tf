data "aws_iam_policy_document" "batch_service_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["batch.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "batch_service" {
  name               = local.names.batch_service_role
  assume_role_policy = data.aws_iam_policy_document.batch_service_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.batch_service_role
  })
}

resource "aws_iam_role_policy_attachment" "batch_service" {
  role       = aws_iam_role.batch_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole"
}

resource "aws_iam_role" "batch_task_execution" {
  name               = local.names.batch_task_execution_role
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.batch_task_execution_role
  })
}

resource "aws_iam_role_policy_attachment" "batch_task_execution" {
  role       = aws_iam_role.batch_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "batch_job" {
  name               = local.names.batch_job_role
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.batch_job_role
  })
}

data "aws_iam_policy_document" "batch_job_s3" {
  statement {
    effect  = "Allow"
    actions = ["s3:ListBucket"]
    resources = [
      "arn:aws:s3:::${local.artifacts_bucket_name}",
      "arn:aws:s3:::${local.config_bucket_name}"
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ]
    resources = ["arn:aws:s3:::${local.artifacts_bucket_name}/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.config_bucket_name}/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::noaa-gfs-bdp-pds/*"]
  }
}

resource "aws_iam_policy" "batch_job_s3" {
  name        = local.names.batch_job_policy
  description = "S3 access for weather ETL batch jobs"
  policy      = data.aws_iam_policy_document.batch_job_s3.json

  tags = merge(local.tags, {
    Name = local.names.batch_job_policy
  })
}

resource "aws_iam_role_policy_attachment" "batch_job_s3" {
  role       = aws_iam_role.batch_job.name
  policy_arn = aws_iam_policy.batch_job_s3.arn
}

resource "aws_iam_role" "ingest_lambda" {
  name               = local.names.gfs_ingest_role
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.gfs_ingest_role
  })
}

data "aws_iam_policy_document" "gfs_ingest_lambda" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["*"]
  }

  statement {
    effect  = "Allow"
    actions = ["batch:SubmitJob"]
    resources = [
      aws_batch_job_definition.worker.arn,
      aws_batch_job_queue.etl.arn
    ]
  }

  statement {
    effect    = "Allow"
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.run_coordinator.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.config_bucket_name}/*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject"
    ]
    resources = ["arn:aws:s3:::${local.artifacts_bucket_name}/runs/gfs/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.artifacts_bucket_name}/manifests/gfs/*"]
  }
}

resource "aws_iam_role_policy" "ingest_lambda" {
  name   = local.names.gfs_ingest_policy
  role   = aws_iam_role.ingest_lambda.id
  policy = data.aws_iam_policy_document.gfs_ingest_lambda.json
}
