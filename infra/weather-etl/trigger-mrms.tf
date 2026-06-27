resource "aws_sqs_queue" "mrms_ingest_dlq" {
  name                      = local.names.mrms_dlq
  message_retention_seconds = var.mrms_sqs_message_retention_seconds

  tags = merge(local.tags, {
    Name = local.names.mrms_dlq
  })
}

resource "aws_sqs_queue" "mrms_ingest" {
  name                       = local.names.mrms_queue
  visibility_timeout_seconds = var.mrms_sqs_visibility_timeout_seconds
  message_retention_seconds  = var.mrms_sqs_message_retention_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.mrms_ingest_dlq.arn
    maxReceiveCount     = 5
  })

  tags = merge(local.tags, {
    Name = local.names.mrms_queue
  })
}

data "aws_iam_policy_document" "mrms_sns_to_sqs" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.mrms_ingest.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [local.mrms_sns_topic_arn]
    }
  }
}

resource "aws_sqs_queue_policy" "mrms_ingest" {
  queue_url = aws_sqs_queue.mrms_ingest.id
  policy    = data.aws_iam_policy_document.mrms_sns_to_sqs.json
}

resource "aws_sns_topic_subscription" "mrms_ingest" {
  topic_arn           = local.mrms_sns_topic_arn
  protocol            = "sqs"
  endpoint            = aws_sqs_queue.mrms_ingest.arn
  filter_policy_scope = "MessageBody"
  filter_policy = jsonencode({
    Records = {
      s3 = {
        bucket = {
          name = ["noaa-mrms-pds"]
        }
        object = {
          key = [{
            wildcard = "CONUS/MergedReflectivityQCComposite_00.50/*/MRMS_MergedReflectivityQCComposite_00.50_*.grib2.gz"
          }]
        }
      }
    }
  })
  raw_message_delivery = false

  depends_on = [aws_sqs_queue_policy.mrms_ingest]
}

resource "aws_iam_role" "ingest_mrms_lambda" {
  name               = local.names.mrms_ingest_role
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = merge(local.tags, {
    Name = local.names.mrms_ingest_role
  })
}

data "aws_iam_policy_document" "mrms_ingest_lambda" {
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
      aws_batch_job_definition.worker_mrms.arn,
      aws_batch_job_queue.etl.arn
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem"
    ]
    resources = [aws_dynamodb_table.frame_claims.arn]
  }

  statement {
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes"
    ]
    resources = [aws_sqs_queue.mrms_ingest.arn]
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
      "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/mrms/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/runs/mrms/*",
      "arn:aws:s3:::noaa-mrms-pds/CONUS/*"
    ]
  }

  statement {
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "arn:aws:s3:::${local.artifacts_bucket_name}/manifests/mrms/*",
      "arn:aws:s3:::${local.artifacts_bucket_name}/runs/mrms/*"
    ]
  }
}

resource "aws_iam_role_policy" "ingest_mrms_lambda" {
  name   = local.names.mrms_ingest_policy
  role   = aws_iam_role.ingest_mrms_lambda.id
  policy = data.aws_iam_policy_document.mrms_ingest_lambda.json
}

resource "aws_lambda_function" "ingest_mrms" {
  function_name    = local.names.mrms_ingest_lambda
  role             = aws_iam_role.ingest_mrms_lambda.arn
  runtime          = "python3.12"
  handler          = "weather_etl.adapters.aws.mrms_ingest_lambda.handler"
  filename         = local.shared_lambda_zip_path
  source_code_hash = local.shared_lambda_zip_hash
  timeout          = var.mrms_ingest_timeout_seconds
  memory_size      = 256

  environment {
    variables = {
      ARTIFACT_ROOT_URI    = local.artifact_root_uri
      BATCH_JOB_QUEUE      = aws_batch_job_queue.etl.name
      BATCH_JOB_DEFINITION = aws_batch_job_definition.worker_mrms.arn
      CATALOG_URI          = local.catalog_uri
      FRAME_CLAIM_TABLE    = aws_dynamodb_table.frame_claims.name
      PIPELINE_URI         = local.pipeline_uri
    }
  }

  tags = merge(local.tags, {
    Name = local.names.mrms_ingest_lambda
  })

  depends_on = [
    aws_iam_role_policy.ingest_mrms_lambda,
    aws_s3_object.pipeline,
    aws_s3_object.catalog
  ]
}

resource "aws_lambda_event_source_mapping" "mrms_ingest" {
  event_source_arn = aws_sqs_queue.mrms_ingest.arn
  function_name    = aws_lambda_function.ingest_mrms.arn
  batch_size       = 10
  enabled          = true
}
