resource "docker_network" "internal" {
  name = "coldbrew_internal"

  lifecycle {
    ignore_changes  = [labels]
    prevent_destroy = true
  }

  labels {
    label = "com.streambrew.environment"
    value = "production"
  }

  labels {
    label = "com.streambrew.managed-by"
    value = "terraform"
  }
}
