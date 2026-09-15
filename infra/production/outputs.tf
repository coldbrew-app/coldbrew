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

output "container_names" {
  description = "Names of every container represented by the currently applied production state."
  value = {
    alerts    = docker_container.alerts.name
    caddy     = docker_container.caddy.name
    chat      = docker_container.chat.name
    donations = docker_container.donations.name
    nats      = docker_container.nats.name
    postgres  = docker_container.postgres.name
    video     = docker_container.video.name
    vector    = docker_container.vector.name
    wal_g     = docker_container.wal_g.name
    web       = docker_container.web.name
  }
}
