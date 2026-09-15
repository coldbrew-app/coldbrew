output "backup_bucket" {
  description = "S3 bucket containing PostgreSQL WAL-G backups."
  value       = aws_s3_bucket.backups.id
}

output "deployment_user" {
  description = "SSH user used for production deployments."
  value       = local.deployment_user
}

output "instance_name" {
  description = "Production Lightsail instance name."
  value       = aws_lightsail_instance.production.name
}

output "public_ip" {
  description = "Current public address of the production Lightsail instance."
  value       = aws_lightsail_instance.production.public_ip_address
}

output "walg_s3_prefix" {
  description = "S3 prefix consumed by WAL-G."
  value       = local.walg_s3_prefix
}
