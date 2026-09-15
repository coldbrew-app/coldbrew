provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = "production"
      ManagedBy   = "Terraform"
      Project     = var.project_name
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
