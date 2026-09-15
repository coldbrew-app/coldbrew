resource "docker_volume" "caddy_data" {
  name = "coldbrew_caddy_data"

  lifecycle {
    ignore_changes  = [labels]
    prevent_destroy = true
  }
}

resource "docker_volume" "caddy_config" {
  name = "coldbrew_caddy_config"

  lifecycle {
    ignore_changes  = [labels]
    prevent_destroy = true
  }
}

resource "docker_volume" "nats_data" {
  name = "coldbrew_nats_data"

  lifecycle {
    ignore_changes  = [labels]
    prevent_destroy = true
  }
}

resource "docker_volume" "postgres_data" {
  name = "coldbrew_postgres_data"

  lifecycle {
    ignore_changes  = [labels]
    prevent_destroy = true
  }
}

resource "docker_volume" "vector_data" {
  name = "coldbrew_vector_data"

  lifecycle {
    ignore_changes  = [labels]
    prevent_destroy = true
  }
}
