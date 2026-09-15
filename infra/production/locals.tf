locals {
  application_container_suffix = "${substr(var.application_revision, 0, 12)}-${var.deployment_nonce}"

  common_labels = {
    "com.streambrew.environment" = "production"
    "com.streambrew.managed-by"  = "terraform"
  }

  runtime_environment_mount  = "/run/streambrew/runtime.env"
  source_runtime_environment = <<-EOT
    set -a
    . ${local.runtime_environment_mount}
    set +a
  EOT
}
