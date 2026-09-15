variable "aws_region" {
  description = "AWS region containing production Lightsail and backup resources."
  type        = string
}

variable "availability_zone" {
  description = "Availability Zone of the production Lightsail instance."
  type        = string
  default     = "eu-central-1a"
}

variable "backup_bucket_name" {
  description = "Existing S3 bucket containing WAL-G backups."
  type        = string

  validation {
    condition     = length(trimspace(var.backup_bucket_name)) > 0
    error_message = "backup_bucket_name must not be empty."
  }
}

variable "backup_prefix" {
  description = "Object prefix inside backup_bucket_name used by WAL-G."
  type        = string
  default     = "wal-g-backup"
}

variable "blueprint_id" {
  description = "Lightsail operating-system blueprint."
  type        = string
  default     = "ubuntu_24_04"
}

variable "bundle_id" {
  description = "Lightsail compute bundle."
  type        = string
  default     = "medium_3_0"
}

variable "instance_name" {
  description = "Stable name of the production Lightsail instance."
  type        = string
  default     = "Ubuntu-1"
}

variable "key_pair_name" {
  description = "Existing Lightsail key pair installed on the production instance."
  type        = string
  default     = "id_rsa"
}

variable "postgres_ingress_cidrs" {
  description = "Trusted IPv4 CIDRs allowed to reach public PostgreSQL. Empty disables public PostgreSQL ingress."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.postgres_ingress_cidrs : can(cidrhost(cidr, 0))])
    error_message = "Every postgres_ingress_cidrs value must be a valid CIDR."
  }
}

variable "postgres_port" {
  description = "Public PostgreSQL administration port when ingress CIDRs are configured."
  type        = number
  default     = 5432

  validation {
    condition     = var.postgres_port >= 1 && var.postgres_port <= 65535
    error_message = "postgres_port must be a valid TCP port."
  }
}

variable "project_name" {
  description = "Stable lowercase name used in AWS tags."
  type        = string
  default     = "streambrew"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name must be a short lowercase AWS-safe name."
  }
}

variable "snapshot_time_utc" {
  description = "UTC hour when Lightsail creates its daily automatic snapshot."
  type        = string
  default     = "03:00"

  validation {
    condition     = can(regex("^(?:[01][0-9]|2[0-3]):00$", var.snapshot_time_utc))
    error_message = "snapshot_time_utc must be an hourly UTC time in HH:00 format."
  }
}

variable "ssh_ingress_cidrs" {
  description = "IPv4 CIDRs allowed to connect over SSH. GitHub-hosted runners require public reachability."
  type        = set(string)
  default     = ["0.0.0.0/0"]
}

variable "ssh_ingress_ipv6_cidrs" {
  description = "IPv6 CIDRs allowed to connect over SSH."
  type        = set(string)
  default     = ["::/0"]
}
