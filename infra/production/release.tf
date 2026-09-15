resource "terraform_data" "release" {
  input = {
    application_image    = var.application_image
    application_revision = var.application_revision
    postgres_image       = var.postgres_image
  }

  depends_on = [
    docker_container.alerts,
    docker_container.caddy,
    docker_container.chat,
    docker_container.donations,
    docker_container.postgres,
    docker_container.video,
    docker_container.vector,
    docker_container.wal_g,
    docker_container.web,
  ]
}
