locals {
  state_bucket_name = "${var.project_name}-${data.aws_caller_identity.current.account_id}-${var.aws_region}-terraform-state"
  github_subject    = coalesce(var.github_oidc_subject, "repo:${var.github_repository}:environment:${var.github_environment}")
  deployment_role   = "${var.project_name}-github-production"
}

resource "aws_s3_bucket" "terraform_state" {
  bucket = local.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = data.aws_iam_policy_document.state_bucket.json
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = []
}

data "aws_iam_policy_document" "github_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_subject]
    }
  }
}

resource "aws_iam_role" "github_production" {
  name               = local.deployment_role
  assume_role_policy = data.aws_iam_policy_document.github_assume_role.json
}

resource "aws_iam_role_policy" "github_production" {
  name   = "${var.project_name}-production-management"
  role   = aws_iam_role.github_production.id
  policy = data.aws_iam_policy_document.github_production.json
}

data "aws_iam_policy_document" "github_production" {
  statement {
    sid = "TerraformStateBucket"
    actions = [
      "s3:GetBucketLocation",
      "s3:GetBucketVersioning",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.terraform_state.arn]
  }

  statement {
    sid = "TerraformStateObjects"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.terraform_state.arn}/${var.project_name}/*"]
  }

  statement {
    sid = "ManageProductionLightsail"
    actions = [
      "lightsail:AllocateStaticIp",
      "lightsail:AttachDisk",
      "lightsail:AttachStaticIp",
      "lightsail:CloseInstancePublicPorts",
      "lightsail:CreateDisk",
      "lightsail:CreateInstances",
      "lightsail:DeleteDisk",
      "lightsail:DeleteInstance",
      "lightsail:DetachDisk",
      "lightsail:DetachStaticIp",
      "lightsail:DisableAddOn",
      "lightsail:EnableAddOn",
      "lightsail:Get*",
      "lightsail:OpenInstancePublicPorts",
      "lightsail:PutInstancePublicPorts",
      "lightsail:RebootInstance",
      "lightsail:ReleaseStaticIp",
      "lightsail:StartInstance",
      "lightsail:StopInstance",
      "lightsail:TagResource",
      "lightsail:UntagResource",
      "lightsail:UpdateDisk",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "ManageBackupBucket"
    actions = ["s3:*"]
    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${var.backup_bucket_name}",
      "arn:${data.aws_partition.current.partition}:s3:::${var.backup_bucket_name}/*",
    ]
  }
}
