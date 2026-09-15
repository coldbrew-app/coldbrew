resource "docker_container" "postgres" {
  name  = "coldbrew-postgres-1"
  image = var.postgres_image

  entrypoint = ["/bin/bash", "-c"]
  command = [<<-EOT
    ${local.source_runtime_environment}
    export POSTGRES_DB="$PGDATABASE"
    export POSTGRES_USER="$PGUSER"
    export POSTGRES_PASSWORD="$PGPASSWORD"
    exec docker-entrypoint.sh postgres \
      -c wal_level=replica \
      -c archive_mode=on \
      -c 'archive_command=/usr/local/bin/wal-g wal-push %p' \
      -c "archive_timeout=$${WALG_ARCHIVE_TIMEOUT_SECONDS:-300}" \
      -c hba_file=/etc/postgresql/pg_hba.conf
  EOT
  ]

  group_add             = [tostring(var.runtime_secrets_gid)]
  restart               = "unless-stopped"
  destroy_grace_seconds = 60
  stop_timeout          = 60
  wait                  = true
  wait_timeout          = 60

  healthcheck {
    test         = ["CMD-SHELL", ". ${local.runtime_environment_mount} && pg_isready -U \"$PGUSER\" -d \"$PGDATABASE\""]
    interval     = "5s"
    timeout      = "3s"
    retries      = 10
    start_period = "5s"
  }

  ports {
    internal = 5432
    external = var.postgres_public_port
    protocol = "tcp"
  }

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["postgres"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  volumes {
    container_path = "/var/lib/postgresql"
    volume_name    = docker_volume.postgres_data.name
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "postgres" })
    content {
      label = labels.key
      value = labels.value
    }
  }
}

resource "docker_container" "wal_g" {
  name  = "coldbrew-wal-g-1"
  image = var.postgres_image

  entrypoint = ["/bin/bash", "-c"]
  command = [<<-EOT
    ${local.source_runtime_environment}
    export PGHOST=postgres
    export PGPORT=5432
    export WALG_BACKUP_INTERVAL_SECONDS="$${WALG_BACKUP_INTERVAL_SECONDS:-86400}"
    export WALG_KEEP_FULL_BACKUPS="$${WALG_KEEP_FULL_BACKUPS:-7}"
    exec docker-entrypoint.sh /usr/local/bin/backup-scheduler /var/lib/postgresql/18/docker
  EOT
  ]

  env                   = ["STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}"]
  group_add             = [tostring(var.runtime_secrets_gid)]
  restart               = "unless-stopped"
  destroy_grace_seconds = 60
  stop_timeout          = 60

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["wal-g"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  volumes {
    container_path = "/var/lib/postgresql"
    volume_name    = docker_volume.postgres_data.name
    read_only      = true
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "wal-g" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.postgres]
}

resource "docker_container" "nats" {
  name  = "coldbrew-nats-1"
  image = local.infrastructure_images["nats"]

  command               = ["--jetstream", "--store_dir", "/data", "--http_port", "8222"]
  restart               = "unless-stopped"
  destroy_grace_seconds = 30
  stop_timeout          = 30
  wait                  = true
  wait_timeout          = 60

  healthcheck {
    test     = ["CMD", "wget", "--spider", "--quiet", "http://127.0.0.1:8222/healthz"]
    interval = "5s"
    timeout  = "3s"
    retries  = 10
  }

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["nats"]
  }

  volumes {
    container_path = "/data"
    volume_name    = docker_volume.nats_data.name
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "nats" })
    content {
      label = labels.key
      value = labels.value
    }
  }
}

resource "docker_container" "chat" {
  name  = "coldbrew-chat-1"
  image = var.application_image

  entrypoint = ["/bin/sh", "-c"]
  command = [<<-EOT
    ${local.source_runtime_environment}
    export CHAT_PUBLIC_URL="$${APP_DOMAIN%/}/api/chat"
    export CHAT_WEB_URL="$APP_DOMAIN"
    exec /app/bin/chat
  EOT
  ]
  env = [
    "CHAT_PORT=3001",
    "STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}",
    "NATS_SERVERS=nats://nats:4222",
  ]
  group_add    = [tostring(var.runtime_secrets_gid)]
  init         = true
  restart      = "unless-stopped"
  memory       = 512
  memory_swap  = 1024
  cpus         = "0.75"
  wait         = true
  wait_timeout = 90

  healthcheck {
    test         = ["CMD-SHELL", "bun -e 'fetch(\"http://127.0.0.1:3001/health\").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'"]
    interval     = "3s"
    timeout      = "3s"
    retries      = 20
    start_period = "5s"
  }

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["chat"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "chat" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.nats, docker_container.postgres]
}

resource "docker_container" "donations" {
  name  = "coldbrew-donations-1"
  image = var.application_image

  entrypoint = ["/bin/sh", "-c"]
  command    = ["${local.source_runtime_environment}\nexec /app/bin/donations"]
  env = [
    "STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}",
    "DONATIONS_PORT=3002",
    "NATS_SERVERS=nats://nats:4222",
  ]
  group_add    = [tostring(var.runtime_secrets_gid)]
  init         = true
  restart      = "unless-stopped"
  memory       = 384
  memory_swap  = 768
  cpus         = "0.5"
  wait         = true
  wait_timeout = 90

  healthcheck {
    test         = ["CMD-SHELL", "bun -e 'fetch(\"http://127.0.0.1:3002/health\").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'"]
    interval     = "3s"
    timeout      = "3s"
    retries      = 20
    start_period = "5s"
  }

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["donations"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "donations" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.nats, docker_container.postgres]
}

resource "docker_container" "video" {
  name  = "coldbrew-video-1"
  image = var.application_image

  entrypoint = ["/bin/sh", "-c"]
  command    = ["${local.source_runtime_environment}\nexec /app/bin/video"]
  env = [
    "STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}",
    "NATS_SERVERS=nats://nats:4222",
  ]
  group_add             = [tostring(var.runtime_secrets_gid)]
  init                  = true
  restart               = "unless-stopped"
  memory                = 256
  memory_swap           = 512
  cpus                  = "0.5"
  destroy_grace_seconds = 30
  stop_timeout          = 30

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["video"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "video" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.nats, docker_container.postgres]
}

resource "docker_container" "alerts" {
  name  = "coldbrew-alerts-1"
  image = var.application_image

  entrypoint = ["/bin/sh", "-c"]
  command    = ["${local.source_runtime_environment}\nexec /app/bin/alerts"]
  env = [
    "STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}",
    "NATS_SERVERS=nats://nats:4222",
  ]
  group_add             = [tostring(var.runtime_secrets_gid)]
  init                  = true
  restart               = "unless-stopped"
  memory                = 128
  memory_swap           = 256
  cpus                  = "0.25"
  destroy_grace_seconds = 30
  stop_timeout          = 30

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["alerts"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "alerts" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.nats]
}

resource "docker_container" "web" {
  name  = "coldbrew-web-1"
  image = var.application_image

  entrypoint  = ["/bin/sh", "-c"]
  command     = ["${local.source_runtime_environment}\nexec bun /app/apps/web/.output/server/index.mjs"]
  working_dir = "/app/apps/web"
  env = [
    "CHAT_SERVICE_URL=http://chat:3001",
    "STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}",
    "DONATIONS_SERVICE_URL=http://donations:3002",
    "NATS_SERVERS=nats://nats:4222",
  ]
  group_add    = [tostring(var.runtime_secrets_gid)]
  init         = true
  restart      = "unless-stopped"
  memory       = 512
  memory_swap  = 1024
  cpus         = "0.75"
  wait         = true
  wait_timeout = 90

  healthcheck {
    test         = ["CMD-SHELL", "bun -e 'fetch(\"http://127.0.0.1:3000/api/health\").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'"]
    interval     = "3s"
    timeout      = "3s"
    retries      = 20
    start_period = "5s"
  }

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["web"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "web" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.chat, docker_container.donations, docker_container.nats, docker_container.postgres]
}

resource "docker_container" "caddy" {
  name  = "coldbrew-caddy-1"
  image = local.infrastructure_images["caddy"]

  entrypoint            = ["/bin/sh", "-c"]
  command               = ["${local.source_runtime_environment}\nexec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile"]
  env                   = ["STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}"]
  group_add             = [tostring(var.runtime_secrets_gid)]
  restart               = "unless-stopped"
  memory                = 128
  memory_swap           = 256
  cpus                  = "0.25"
  destroy_grace_seconds = 30
  stop_timeout          = 30

  ports {
    internal = 80
    external = 80
    protocol = "tcp"
  }

  ports {
    internal = 443
    external = 443
    protocol = "tcp"
  }

  ports {
    internal = 443
    external = 443
    protocol = "udp"
  }

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["caddy"]
  }

  volumes {
    container_path = local.runtime_environment_mount
    host_path      = var.runtime_config_path
    read_only      = true
  }

  volumes {
    container_path = "/data"
    volume_name    = docker_volume.caddy_data.name
  }

  volumes {
    container_path = "/config"
    volume_name    = docker_volume.caddy_config.name
  }

  upload {
    source      = "${path.module}/../../Caddyfile"
    source_hash = filesha256("${path.module}/../../Caddyfile")
    file        = "/etc/caddy/Caddyfile"
    permissions = "0644"
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "caddy" })
    content {
      label = labels.key
      value = labels.value
    }
  }

  depends_on = [docker_container.web]
}

resource "docker_container" "vector" {
  name  = "coldbrew-vector-1"
  image = local.infrastructure_images["vector"]

  command               = ["--config", "/etc/vector/vector.yaml", "--require-healthy", "true"]
  env                   = ["STREAMBREW_DEPLOYMENT_NONCE=${var.deployment_nonce}"]
  group_add             = [tostring(var.runtime_secrets_gid)]
  restart               = "unless-stopped"
  memory                = 128
  memory_swap           = 256
  cpus                  = "0.25"
  destroy_grace_seconds = 30
  stop_timeout          = 30

  networks_advanced {
    name    = docker_network.internal.name
    aliases = ["vector"]
  }

  volumes {
    container_path = "/run/secrets/axiom_token"
    host_path      = var.axiom_token_path
    read_only      = true
  }

  volumes {
    container_path = "/var/run/docker.sock"
    host_path      = "/var/run/docker.sock"
    read_only      = true
  }

  volumes {
    container_path = "/var/lib/vector"
    volume_name    = docker_volume.vector_data.name
  }

  upload {
    source      = "${path.module}/../../observability/vector.yaml"
    source_hash = filesha256("${path.module}/../../observability/vector.yaml")
    file        = "/etc/vector/vector.yaml"
    permissions = "0644"
  }

  dynamic "labels" {
    for_each = merge(local.common_labels, { "com.docker.compose.service" = "vector" })
    content {
      label = labels.key
      value = labels.value
    }
  }
}
