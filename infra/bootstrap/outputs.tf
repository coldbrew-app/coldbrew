output "deployment_role_arn" {
  description = "GitHub Actions OIDC role for infrastructure and runtime deployments."
  value       = aws_iam_role.github_production.arn
}

output "state_bucket" {
  description = "S3 bucket used by every remote Terraform root."
  value       = aws_s3_bucket.terraform_state.id
}
