resource "aws_dynamodb_table" "run_coordinator" {
  name         = local.names.run_coordinator_table
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
    Name = local.names.run_coordinator_table
  })
}
