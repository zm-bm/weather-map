data "aws_lb" "edge" {
  name = "zmbm-edge"
}

data "aws_lb_listener" "edge_http" {
  load_balancer_arn = data.aws_lb.edge.arn
  port              = 80
}

resource "aws_iam_role" "weather_map_api_lambda" {
  name = "weather-map-api-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
    Name      = "weather-map-api-lambda-role"
  }
}

resource "aws_iam_role_policy" "weather_map_api_lambda" {
  name = "weather-map-api-lambda-policy"
  role = aws_iam_role.weather_map_api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = "arn:aws:s3:::${data.terraform_remote_state.weather_etl.outputs.artifacts_bucket_name}"
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "manifests/*",
              "runs/*"
            ]
          }
        }
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [
          "arn:aws:s3:::${data.terraform_remote_state.weather_etl.outputs.artifacts_bucket_name}/manifests/*",
          "arn:aws:s3:::${data.terraform_remote_state.weather_etl.outputs.artifacts_bucket_name}/runs/*",
          "arn:aws:s3:::${data.terraform_remote_state.weather_etl.outputs.config_bucket_name}/weather-etl/pipeline_config.json"
        ]
      }
    ]
  })
}

resource "aws_lambda_function" "weather_map_api" {
  function_name    = "weather-map-api"
  role             = aws_iam_role.weather_map_api_lambda.arn
  runtime          = "python3.12"
  handler          = "weather_map_backend.lambda_handler.handler"
  filename         = local.backend_lambda_zip_path
  source_code_hash = filebase64sha256(local.backend_lambda_zip_path)
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      ARTIFACT_ROOT_URI   = "s3://${data.terraform_remote_state.weather_etl.outputs.artifacts_bucket_name}"
      PIPELINE_CONFIG_URI = data.terraform_remote_state.weather_etl.outputs.pipeline_config_uri
    }
  }

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
    Name      = "weather-map-api"
  }
}

resource "aws_lb_target_group" "weather_map_api" {
  name        = "weather-map-api-tg"
  target_type = "lambda"

  health_check {
    enabled             = true
    path                = "/api/ready"
    matcher             = "200-399"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Env       = "prod"
    ManagedBy = "terraform"
    Stack     = "weather-map-site"
    Name      = "weather-map-api-tg"
  }
}

resource "aws_lambda_permission" "allow_alb_weather_map_api" {
  statement_id  = "AllowExecutionFromAlbWeatherMapApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.weather_map_api.function_name
  principal     = "elasticloadbalancing.amazonaws.com"
  source_arn    = aws_lb_target_group.weather_map_api.arn
}

resource "aws_lb_target_group_attachment" "weather_map_api" {
  target_group_arn = aws_lb_target_group.weather_map_api.arn
  target_id        = aws_lambda_function.weather_map_api.arn

  depends_on = [aws_lambda_permission.allow_alb_weather_map_api]
}

resource "aws_lb_listener_rule" "weather_map_api" {
  listener_arn = data.aws_lb_listener.edge_http.arn
  priority     = 120

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.weather_map_api.arn
  }

  condition {
    http_header {
      http_header_name = "X-App-Name"
      values           = [local.weather_map_api_app_header_value]
    }
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
