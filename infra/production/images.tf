locals {
  infrastructure_images = {
    caddy  = "caddy:2.10.2-alpine"
    nats   = "nats:2.11.17-alpine"
    vector = "timberio/vector:0.58.0-alpine"
  }
}
