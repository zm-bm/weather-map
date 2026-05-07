resource "aws_ecr_repository" "worker" {
  name                 = "weather-etl-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.tags, {
    Name = "weather-etl-worker"
  })
}

resource "aws_cloudwatch_log_group" "batch" {
  name              = "/aws/batch/weather-etl"
  retention_in_days = 14

  tags = merge(local.tags, {
    Name = "weather-etl-batch"
  })
}

resource "aws_security_group" "batch_tasks" {
  name        = "weather-etl-batch-tasks"
  description = "Security group for weather ETL Batch tasks"
  vpc_id      = data.terraform_remote_state.network.outputs.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = "weather-etl-batch-tasks"
  })
}

resource "aws_batch_compute_environment" "etl" {
  name         = "weather-etl-fargate-spot"
  service_role = aws_iam_role.batch_service.arn
  type         = "MANAGED"
  state        = "ENABLED"

  compute_resources {
    type               = "FARGATE_SPOT"
    max_vcpus          = 8
    subnets            = data.terraform_remote_state.network.outputs.public_subnet_ids
    security_group_ids = [aws_security_group.batch_tasks.id]
  }

  depends_on = [aws_iam_role_policy_attachment.batch_service]

  tags = merge(local.tags, {
    Name = "weather-etl-fargate-spot"
  })
}

resource "aws_batch_job_queue" "etl" {
  name     = "weather-etl"
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.etl.arn
  }

  tags = merge(local.tags, {
    Name = "weather-etl"
  })
}

resource "aws_batch_job_definition" "worker" {
  name = "weather-etl-worker"
  type = "container"

  platform_capabilities = ["FARGATE"]

  container_properties = jsonencode({
    image            = "${aws_ecr_repository.worker.repository_url}:latest"
    executionRoleArn = aws_iam_role.batch_task_execution.arn
    jobRoleArn       = aws_iam_role.batch_job.arn
    resourceRequirements = [
      { type = "VCPU", value = "1" },
      { type = "MEMORY", value = "2048" }
    ]
    networkConfiguration = {
      assignPublicIp = "ENABLED"
    }
    environment = [
      { name = "ARTIFACT_ROOT_URI", value = "s3://${local.artifacts_bucket_name}" },
      { name = "PIPELINE_CONFIG_URI", value = local.pipeline_config_uri },
      { name = "AWS_DEFAULT_REGION", value = var.aws_region }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.batch.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  })

  retry_strategy {
    attempts = 3
  }

  timeout {
    attempt_duration_seconds = 7200
  }

  tags = merge(local.tags, {
    Name = "weather-etl-worker"
  })

  depends_on = [aws_s3_object.forecast_config]
}
