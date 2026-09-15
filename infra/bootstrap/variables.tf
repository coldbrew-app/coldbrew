variable "aws_region" {
  description = "AWS region containing the Terraform state bucket and production infrastructure."
  type        = string
}

variable "backup_bucket_name" {
  description = "Existing S3 bucket containing production WAL-G backups."
  type        = string
}

variable "github_environment" {
  description = "GitHub environment allowed to assume the deployment role."
  type        = string
  default     = "Production"
}

variable "github_oidc_subject" {
  description = "Optional exact GitHub OIDC sub claim, including immutable owner/repository IDs when enabled."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.github_oidc_subject == null || startswith(var.github_oidc_subject, "repo:")
    error_message = "github_oidc_subject must be an exact GitHub repository sub claim."
  }
}

variable "github_repository" {
  description = "GitHub repository in owner/name form."
  type        = string

  validation {
    condition     = can(regex("^[^/]+/[^/]+$", var.github_repository))
    error_message = "github_repository must use owner/name form."
  }
}

variable "project_name" {
  description = "Stable lowercase name used in AWS resource names and tags."
  type        = string
  default     = "streambrew"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name must be a short lowercase AWS-safe name."
  }
}
