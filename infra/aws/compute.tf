resource "aws_lightsail_instance" "production" {
  name              = var.instance_name
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  ip_address_type   = "dualstack"
  key_pair_name     = var.key_pair_name
  user_data         = file("${path.module}/cloud-init.yaml")

  add_on {
    type          = "AutoSnapshot"
    snapshot_time = var.snapshot_time_utc
    status        = "Enabled"
  }

  tags = {
    Name = local.name_prefix
    Role = "container-host"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [user_data]
  }
}
