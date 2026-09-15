variable "application_image" {
  description = "Immutable application image reference, including its commit-SHA tag."
  type        = string

  validation {
    condition     = can(regex("^ghcr\\.io/.+:[0-9a-f]{40}$", var.application_image))
    error_message = "application_image must be a GHCR image tagged with a full Git commit SHA."
  }
}

variable "application_revision" {
  description = "Full Git commit SHA represented by the application deployment."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.application_revision))
    error_message = "application_revision must be a full Git commit SHA."
  }
}

variable "docker_host" {
  description = "SSH Docker endpoint for the production host."
  type        = string

  validation {
    condition     = startswith(var.docker_host, "ssh://")
    error_message = "docker_host must use the ssh:// transport."
  }
}

variable "deployment_nonce" {
  description = "Non-secret workflow run identifier used to reload mounted runtime configuration."
  type        = string

  validation {
    condition     = length(trimspace(var.deployment_nonce)) > 0
    error_message = "deployment_nonce must not be empty."
  }
}

variable "postgres_image" {
  description = "Immutable PostgreSQL/WAL-G image reference."
  type        = string

  validation {
    condition     = can(regex("^ghcr\\.io/.+:[0-9a-f]{40}$", var.postgres_image))
    error_message = "postgres_image must be a GHCR image tagged with a full Git tree SHA."
  }
}

variable "postgres_public_port" {
  description = "TCP port on the host exposed for PostgreSQL administration and migrations."
  type        = number
  default     = 5432

  validation {
    condition     = var.postgres_public_port >= 1 && var.postgres_public_port <= 65535
    error_message = "postgres_public_port must be a valid TCP port."
  }
}

variable "runtime_config_path" {
  description = "Absolute path to the shell-compatible runtime environment on the production host."
  type        = string
  default     = "/opt/streambrew/runtime.env"

  validation {
    condition     = startswith(var.runtime_config_path, "/")
    error_message = "runtime_config_path must be absolute."
  }
}

variable "runtime_secrets_gid" {
  description = "Host group ID allowed to read the runtime environment and Vector token."
  type        = number
}

variable "axiom_token_path" {
  description = "Absolute path to the Axiom ingest token on the production host."
  type        = string
  default     = "/opt/streambrew/axiom_token"

  validation {
    condition     = startswith(var.axiom_token_path, "/")
    error_message = "axiom_token_path must be absolute."
  }
}
