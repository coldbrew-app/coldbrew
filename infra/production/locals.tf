locals {
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
