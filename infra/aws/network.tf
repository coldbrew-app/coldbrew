resource "aws_lightsail_instance_public_ports" "production" {
  instance_name = aws_lightsail_instance.production.name

  port_info {
    protocol   = "tcp"
    from_port  = 22
    to_port    = 22
    cidrs      = var.ssh_ingress_cidrs
    ipv6_cidrs = var.ssh_ingress_ipv6_cidrs
  }

  port_info {
    protocol   = "tcp"
    from_port  = 80
    to_port    = 80
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  port_info {
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  port_info {
    protocol   = "udp"
    from_port  = 443
    to_port    = 443
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  dynamic "port_info" {
    for_each = length(var.postgres_ingress_cidrs) == 0 ? [] : [var.postgres_ingress_cidrs]

    content {
      protocol  = "tcp"
      from_port = var.postgres_port
      to_port   = var.postgres_port
      cidrs     = port_info.value
    }
  }
}
