locals {
  deployment_user = "ubuntu"
  name_prefix     = "${var.project_name}-production"
  walg_s3_prefix  = "s3://${var.backup_bucket_name}/${var.backup_prefix}"
}
