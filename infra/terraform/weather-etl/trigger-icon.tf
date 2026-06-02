resource "aws_dynamodb_table" "icon_ingest_state" {
  name         = local.names.icon_ingest_state_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge(local.tags, {
    Name = local.names.icon_ingest_state_table
  })
}

resource "aws_iam_role" "ingest_icon_lambda" {
  name               = local.names.icon_ingest_role
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.icon_ingest_role
  })
}

data "aws_iam_policy_document" "icon_ingest_lambda" {
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
      aws_batch_job_definition.worker_icon.arn,
      aws_batch_job_queue.etl.arn
    ]
  }

  statement {
    effect  = "Allow"
    actions = ["dynamodb:UpdateItem"]
    resources = [
      aws_dynamodb_table.icon_ingest_state.arn,
      aws_dynamodb_table.run_coordinator.arn
    ]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.artifacts_bucket_name}"]
  }

  statement {
    effect  = "Allow"
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::${local.config_bucket_name}/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/icon/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/runs/icon/*"
    ]
  }

  statement {
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/icon/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/runs/icon/*"
    ]
  }
}

resource "aws_iam_role_policy" "ingest_icon_lambda" {
  name   = local.names.icon_ingest_policy
  role   = aws_iam_role.ingest_icon_lambda.id
  policy = data.aws_iam_policy_document.icon_ingest_lambda.json
}

resource "aws_lambda_function" "ingest_icon" {
  function_name    = local.names.icon_ingest_lambda
  role             = aws_iam_role.ingest_icon_lambda.arn
  runtime          = "python3.12"
  handler          = "forecast_etl.aws.icon_ingest.handler"
  filename         = local.shared_lambda_zip_path
  source_code_hash = local.shared_lambda_zip_hash
  timeout          = var.icon_ingest_timeout_seconds
  memory_size      = 256

  environment {
    variables = {
      ARTIFACT_ROOT_URI     = local.artifact_root_uri
      BATCH_JOB_QUEUE       = aws_batch_job_queue.etl.name
      BATCH_JOB_DEFINITION  = aws_batch_job_definition.worker_icon.arn
      ICON_POLL_CYCLE_COUNT = tostring(var.icon_poll_cycle_count)
      ICON_STATE_TABLE      = aws_dynamodb_table.icon_ingest_state.name
      PIPELINE_CONFIG_URI   = local.pipeline_config_uri
      FORECAST_CATALOG_URI  = local.forecast_catalog_uri
      RUN_COORDINATOR_TABLE = aws_dynamodb_table.run_coordinator.name
    }
  }

  tags = merge(local.tags, {
    Name = local.names.icon_ingest_lambda
  })

  depends_on = [aws_s3_object.forecast_config, aws_s3_object.forecast_catalog]
}

resource "aws_cloudwatch_event_rule" "ingest_icon_poll" {
  name                = local.names.icon_ingest_schedule
  description         = "Poll DWD ICON file readiness and submit ETL jobs"
  schedule_expression = var.icon_ingest_schedule_expression

  tags = merge(local.tags, {
    Name = local.names.icon_ingest_schedule
  })
}

resource "aws_cloudwatch_event_target" "ingest_icon_poll" {
  rule = aws_cloudwatch_event_rule.ingest_icon_poll.name
  arn  = aws_lambda_function.ingest_icon.arn
}

resource "aws_lambda_permission" "allow_eventbridge_icon" {
  statement_id_prefix = "AllowExecutionFromEventBridgeIcon-"
  action              = "lambda:InvokeFunction"
  function_name       = aws_lambda_function.ingest_icon.function_name
  principal           = "events.amazonaws.com"
  source_arn          = aws_cloudwatch_event_rule.ingest_icon_poll.arn

  lifecycle {
    create_before_destroy = true
  }
}
