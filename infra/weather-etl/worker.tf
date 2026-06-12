resource "aws_ecr_repository" "worker" {
  name                 = local.names.worker_repository
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.tags, {
    Name = local.names.worker_repository
  })
}

resource "aws_cloudwatch_log_group" "batch" {
  name              = local.names.batch_log_group
  retention_in_days = var.batch_log_retention_days

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-batch"
  })
}

resource "aws_security_group" "batch_tasks" {
  name        = local.names.batch_security_group
  description = "Security group for weather ETL Batch tasks"
  vpc_id      = data.terraform_remote_state.network.outputs.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, {
    Name = local.names.batch_security_group
  })
}

resource "aws_batch_compute_environment" "etl" {
  name         = local.names.batch_compute_environment
  service_role = aws_iam_role.batch_service.arn
  type         = "MANAGED"
  state        = "ENABLED"

  compute_resources {
    type               = "FARGATE_SPOT"
    max_vcpus          = var.batch_max_vcpus
    subnets            = data.terraform_remote_state.network.outputs.public_subnet_ids
    security_group_ids = [aws_security_group.batch_tasks.id]
  }

  depends_on = [aws_iam_role_policy_attachment.batch_service]

  tags = merge(local.tags, {
    Name = local.names.batch_compute_environment
  })
}

resource "aws_batch_job_queue" "etl" {
  name     = local.names.batch_queue
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.etl.arn
  }

  tags = merge(local.tags, {
    Name = local.names.batch_queue
  })
}

resource "aws_batch_job_definition" "worker" {
  name = local.names.worker_gfs_job_definition
  type = "container"

  platform_capabilities = ["FARGATE"]

  container_properties = jsonencode({
    image            = "${aws_ecr_repository.worker.repository_url}:${var.worker_image_tag}"
    executionRoleArn = aws_iam_role.batch_task_execution.arn
    jobRoleArn       = aws_iam_role.batch_job.arn
    resourceRequirements = [
      { type = "VCPU", value = "1" },
      { type = "MEMORY", value = tostring(var.gfs_worker_memory_mib) }
    ]
    networkConfiguration = {
      assignPublicIp = "ENABLED"
    }
    environment = [
      { name = "ARTIFACT_ROOT_URI", value = local.artifact_root_uri },
      { name = "PIPELINE_URI", value = local.pipeline_uri },
      { name = "CATALOG_URI", value = local.catalog_uri },
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
    attempts = var.batch_retry_attempts
  }

  timeout {
    attempt_duration_seconds = var.gfs_worker_timeout_seconds
  }

  tags = merge(local.tags, {
    Name = local.names.worker_gfs_job_definition
  })

  depends_on = [aws_s3_object.pipeline, aws_s3_object.catalog]
}

resource "aws_batch_job_definition" "worker_icon" {
  name = local.names.worker_icon_job_definition
  type = "container"

  platform_capabilities = ["FARGATE"]

  container_properties = jsonencode({
    image            = "${aws_ecr_repository.worker.repository_url}:${var.worker_image_tag}"
    executionRoleArn = aws_iam_role.batch_task_execution.arn
    jobRoleArn       = aws_iam_role.batch_job.arn
    resourceRequirements = [
      { type = "VCPU", value = "1" },
      { type = "MEMORY", value = tostring(var.icon_worker_memory_mib) }
    ]
    networkConfiguration = {
      assignPublicIp = "ENABLED"
    }
    environment = [
      { name = "ARTIFACT_ROOT_URI", value = local.artifact_root_uri },
      { name = "PIPELINE_URI", value = local.pipeline_uri },
      { name = "CATALOG_URI", value = local.catalog_uri },
      { name = "AWS_DEFAULT_REGION", value = var.aws_region },
      { name = "ICON_SOURCE_WAIT_SECONDS", value = "2700" },
      { name = "ICON_REGRID_DESCRIPTION_FILE", value = "/opt/dwd-regrid/descriptions/icon/icon_description.txt" },
      { name = "ICON_REGRID_WEIGHTS_FILE", value = "/opt/dwd-regrid/weights/icon/icon_weights.nc" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.batch.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker-icon"
      }
    }
  })

  retry_strategy {
    attempts = var.batch_retry_attempts
  }

  timeout {
    attempt_duration_seconds = var.icon_worker_timeout_seconds
  }

  tags = merge(local.tags, {
    Name = local.names.worker_icon_job_definition
  })

  depends_on = [aws_s3_object.pipeline, aws_s3_object.catalog]
}

resource "aws_batch_job_definition" "worker_mrms" {
  name = local.names.worker_mrms_job_definition
  type = "container"

  platform_capabilities = ["FARGATE"]

  container_properties = jsonencode({
    image            = "${aws_ecr_repository.worker.repository_url}:${var.worker_image_tag}"
    executionRoleArn = aws_iam_role.batch_task_execution.arn
    jobRoleArn       = aws_iam_role.batch_job.arn
    resourceRequirements = [
      { type = "VCPU", value = "1" },
      { type = "MEMORY", value = tostring(var.mrms_worker_memory_mib) }
    ]
    networkConfiguration = {
      assignPublicIp = "ENABLED"
    }
    environment = [
      { name = "ARTIFACT_ROOT_URI", value = local.artifact_root_uri },
      { name = "PIPELINE_URI", value = local.pipeline_uri },
      { name = "CATALOG_URI", value = local.catalog_uri },
      { name = "AWS_DEFAULT_REGION", value = var.aws_region }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.batch.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker-mrms"
      }
    }
  })

  retry_strategy {
    attempts = var.batch_retry_attempts
  }

  timeout {
    attempt_duration_seconds = var.mrms_worker_timeout_seconds
  }

  tags = merge(local.tags, {
    Name = local.names.worker_mrms_job_definition
  })

  depends_on = [aws_s3_object.pipeline, aws_s3_object.catalog]
}
