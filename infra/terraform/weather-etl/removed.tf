removed {
  from = module.gfs_artifacts_bucket.aws_s3_bucket.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_artifacts_bucket.aws_s3_bucket_versioning.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_artifacts_bucket.aws_s3_bucket_public_access_block.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_artifacts_bucket.aws_s3_bucket_server_side_encryption_configuration.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_config_bucket.aws_s3_bucket.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_config_bucket.aws_s3_bucket_versioning.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_config_bucket.aws_s3_bucket_public_access_block.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = module.gfs_config_bucket.aws_s3_bucket_server_side_encryption_configuration.this

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket.gfs_artifacts

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_versioning.gfs_artifacts

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_public_access_block.gfs_artifacts

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_server_side_encryption_configuration.gfs_artifacts

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket.gfs_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_versioning.gfs_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_public_access_block.gfs_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_bucket_server_side_encryption_configuration.gfs_config

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_ecr_repository.gfs_worker

  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_s3_object.pipeline_config

  lifecycle {
    destroy = false
  }
}
