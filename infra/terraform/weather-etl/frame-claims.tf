resource "aws_dynamodb_table" "frame_claims" {
  name         = local.names.frame_claim_table
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
    Name = local.names.frame_claim_table
  })
}
