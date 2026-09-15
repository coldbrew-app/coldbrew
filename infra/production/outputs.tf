output "application_revision" {
  description = "Git revision represented by the currently applied production state."
  value       = terraform_data.release.output.application_revision
}

output "application_image" {
  description = "Application image represented by the currently applied production state."
  value       = terraform_data.release.output.application_image
}

output "postgres_image" {
  description = "PostgreSQL/WAL-G image represented by the currently applied production state."
  value       = terraform_data.release.output.postgres_image
}
