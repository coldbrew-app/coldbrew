# StreamBrew production deployment

The main application stays on AWS and is split into three Terraform roots. This
keeps routine releases independent from cloud provisioning and keeps the
application runtime portable:

| Root               | State                           | Responsibility                                                        | Normal trigger                         |
| ------------------ | ------------------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| `infra/bootstrap`  | local, operator-held            | S3 state bucket and GitHub OIDC role                                  | once from an authenticated workstation |
| `infra/aws`        | `streambrew/aws.tfstate`        | Lightsail instance, firewall, snapshots, and S3 backups               | manual `AWS infrastructure` workflow   |
| `infra/production` | `streambrew/production.tfstate` | Docker network, containers, persistent volumes, and deployed revision | every production release               |

`compose.yaml` remains a development and emergency-recovery reference. Normal
production releases do not copy the repository to the server and do not run
Compose there. GitHub Actions builds immutable images, pulls them over SSH, and
Terraform reconciles the Docker runtime.

The bandwidth-heavy multistream media plane is the one exception: it runs as a
stateless container on Hetzner Cloud and is deployed by
`.github/workflows/restream.yml`. The AWS application remains its control plane.
See [Multistream architecture and operations](restream.md) for provisioning,
security boundaries, secrets, and recovery.

## Architecture

The AWS root manages:

- one Ubuntu 24.04 Lightsail instance with Docker installed by cloud-init;
- TCP 80/443 and UDP 443 for Caddy;
- public SSH, because GitHub-hosted runners do not have stable source addresses;
- optional public PostgreSQL access from explicit IPv4 CIDRs;
- automatic daily Lightsail snapshots;
- an encrypted, versioned, private S3 bucket for WAL-G backups.

The Lightsail instance, backup bucket, and all Docker volumes have Terraform
`prevent_destroy` guards. An ordinary plan cannot delete PostgreSQL, NATS,
Caddy, Vector, or backup data. Do not remove a guard to get past a surprising
plan: determine why replacement is proposed first.

The production root talks to the remote Docker daemon over SSH. It manages ten
containers, the `coldbrew_internal` network, and the existing `coldbrew_*`
volumes. Application containers read a single shell-compatible `runtime.env`;
Vector reads the Axiom token from a separate read-only file. Neither file is
stored in Terraform state.

Lightsail does not provide an EC2-style instance role to containers. WAL-G
therefore uses a narrowly scoped AWS access-key pair supplied through the
`Production` GitHub environment. Restrict it to the configured backup bucket and
prefix, rotate it periodically, and never reuse the Terraform deployment role.

The current instance uses a dynamic Lightsail public IP. GitHub discovers it on
every run, but public DNS and `SSH_KNOWN_HOSTS` must be updated after an instance
stop/start changes the address. A future planned maintenance window can attach a
Lightsail static IP and update DNS once; do not attach one without coordinating
that DNS cutover.

## Portability

Only `infra/aws` and the AWS authentication steps are provider-specific. The
container topology, immutable GHCR images, runtime file contract, health checks,
and PostgreSQL/WAL-G restore path live in `infra/production`. A move to Hetzner
can therefore replace the cloud root and host-discovery/authentication steps
while retaining the Docker root and application configuration. The state files
must remain separate; never try to change an AWS resource's provider in place.

The portable boundary is the container and backup layer, not the VM disk. To
move providers, create the new host, install Docker, restore a verified WAL-G
backup into a new volume, apply `infra/production` against the new SSH endpoint,
test it, and then change DNS. This is a database cutover, not a Terraform file
translation alone.

## State and secret boundaries

The bootstrap root creates the S3 state bucket before an S3 backend can be
initialized. Its local state is operationally important even though it contains
no application credentials: keep an encrypted backup and never commit it.

Remote state uses S3 encryption, versioning, complete public-access blocking,
TLS-only access, and native S3 lock files. There is no DynamoDB lock table.
Keep bucket version history so an accidental state write can be recovered.

GitHub Actions assumes the deployment role through OIDC. Its trust is restricted
to this repository and the `Production` environment. Application secrets are
rendered directly into host files with mode `0640`. The workflow uses its
short-lived `GITHUB_TOKEN` to pull private GHCR images and logs out afterward.

Never commit `.tfstate`, `.tfplan`, backend credentials, `runtime.env`, token
files, or local `terraform.tfvars`. Commit `.terraform.lock.hcl` for reproducible
provider installs.

## Bootstrap

Use Terraform 1.16.2 and temporary operator credentials that may create S3,
IAM, and the GitHub OIDC provider. Copy and edit the ignored variables file:

```sh
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output
```

If the account already has GitHub's OIDC provider, import it before planning:

```sh
terraform -chdir=infra/bootstrap import \
  aws_iam_openid_connect_provider.github \
  arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com
```

Set the outputs on the `Production` GitHub environment:

- `TF_STATE_BUCKET` from `state_bucket`;
- `AWS_TERRAFORM_ROLE_ARN` from `deployment_role_arn`;
- `TF_STATE_REGION` and `AWS_REGION` to the selected region.

Protect the environment so only `master` can deploy. See GitHub's
[AWS OIDC guide](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
for the repository/environment subject format.

## GitHub configuration

Infrastructure variables:

| Name                              | Example                    | Required |
| --------------------------------- | -------------------------- | -------- |
| `AWS_PROJECT_NAME`                | `streambrew`               | no       |
| `AWS_REGION`                      | `eu-central-1`             | yes      |
| `AWS_TERRAFORM_ROLE_ARN`          | bootstrap output           | yes      |
| `TF_STATE_BUCKET`                 | bootstrap output           | yes      |
| `TF_STATE_REGION`                 | `eu-central-1`             | yes      |
| `AWS_LIGHTSAIL_INSTANCE_NAME`     | `Ubuntu-1`                 | yes      |
| `AWS_LIGHTSAIL_AVAILABILITY_ZONE` | `eu-central-1a`            | no       |
| `AWS_LIGHTSAIL_BLUEPRINT_ID`      | `ubuntu_24_04`             | no       |
| `AWS_LIGHTSAIL_BUNDLE_ID`         | `medium_3_0`               | no       |
| `AWS_LIGHTSAIL_KEY_PAIR_NAME`     | `id_rsa`                   | yes      |
| `AWS_LIGHTSAIL_SNAPSHOT_TIME_UTC` | `03:00`                    | no       |
| `WALG_S3_BUCKET`                  | existing backup bucket     | yes      |
| `WALG_S3_PREFIX`                  | `s3://bucket/wal-g-backup` | yes      |
| `PG_INGRESS_CIDRS`                | `["203.0.113.10/32"]`      | no       |
| `SSH_INGRESS_CIDRS`               | `["0.0.0.0/0"]`            | no       |
| `SSH_INGRESS_IPV6_CIDRS`          | `["::/0"]`                 | no       |
| `SSH_DEPLOY_PATH`                 | `/home/ubuntu/coldbrew`    | yes      |

`PG_INGRESS_CIDRS=[]` closes public PostgreSQL. Prefer an SSH tunnel and an
empty list. Public SSH is required for GitHub-hosted runners; the private key
and strict host-key verification remain the authentication boundary.

Runtime variables:

| Name                           | Example                          | Required  |
| ------------------------------ | -------------------------------- | --------- |
| `APP_DOMAIN`                   | `https://streambrew.example.com` | yes       |
| `PGDATABASE`                   | `streambrew`                     | yes       |
| `PGHOST`                       | `postgres`                       | yes       |
| `PGPORT`                       | `5432`                           | no        |
| `PGUSER`                       | `streambrew`                     | yes       |
| `ADMIN_EMAILS`                 | `admin@example.com`              | no        |
| `DONATION_ALERTS_CLIENT_ID`    | OAuth client ID                  | yes       |
| `GOOGLE_CLIENT_ID`             | OAuth client ID                  | yes       |
| `STREAMLABS_CLIENT_ID`         | OAuth client ID                  | yes       |
| `STREAMELEMENTS_CLIENT_ID`     | OAuth client ID                  | yes       |
| `BOOSTY_CLIENT_ID`             | OAuth client ID                  | no        |
| `KICK_CLIENT_ID`               | OAuth client ID                  | no        |
| `KICK_WEBHOOK_PUBLIC_KEY`      | RSA public key                   | with Kick |
| `TWITCH_CLIENT_ID`             | OAuth client ID                  | no        |
| `VK_VIDEO_CLIENT_ID`           | OAuth client ID                  | no        |
| `YOUTUBE_CLIENT_ID`            | OAuth client ID                  | no        |
| `TELEGRAM_ADMIN_CHAT_ID`       | notification chat ID             | no        |
| `WALG_ARCHIVE_TIMEOUT_SECONDS` | `300`                            | no        |
| `WALG_BACKUP_INTERVAL_SECONDS` | `86400`                          | no        |
| `WALG_KEEP_FULL_BACKUPS`       | `7`                              | no        |
| `RESTREAM_INGEST_URL`          | `rtmp://media.example.com:1935`  | yes       |

Required environment secrets are `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`,
`AXIOM_TOKEN`, `BETTER_AUTH_SECRET`, `CHAT_SERVICE_SECRET`,
`CHAT_TOKEN_ENCRYPTION_SECRET`, `DONATION_ALERTS_CLIENT_SECRET`,
`DONATIONS_SERVICE_SECRET`, `GOOGLE_CLIENT_SECRET`, `PGPASSWORD`,
`RESTREAM_CREDENTIALS_SECRET`, `RESTREAM_MEDIA_SHARED_SECRET`,
`STREAMLABS_CLIENT_SECRET`, `STREAMELEMENTS_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`,
`YOUTUBE_API_KEY`, and the
WAL-G-only `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pair. Optional OAuth
secrets must be configured together with their matching client IDs. The
Hetzner deployment also has its own variables and secrets documented in
[Multistream architecture and operations](restream.md#github-production-environment).

Create `SSH_KNOWN_HOSTS` using the alias expected by the workflows, then verify
the fingerprint through the Lightsail console before saving it:

```sh
ssh-keyscan -t ed25519 <public-ip> | \
  sed 's/^<public-ip>/streambrew-production/'
```

Register the relevant OAuth callback URLs:

- `https://<domain>/api/auth/callback/google`
- `https://<domain>/api/integration/donationalerts/callback`
- `https://<domain>/api/integration/streamlabs/callback`
- `https://<domain>/api/integration/streamelements/callback`
- `https://<domain>/api/chat/oauth/youtube/callback`
- `https://<domain>/api/chat/oauth/twitch/callback`
- `https://<domain>/api/chat/oauth/kick/callback`
- `https://<domain>/api/chat/oauth/vk_video/callback`

Create the `streambrew-logs` dataset in Axiom and restrict its token to ingest.

## Infrastructure changes

Run `AWS infrastructure` manually with `action=plan`, review the complete plan,
then rerun it with `action=apply`. The workflow applies the saved plan and waits
for cloud-init and Docker. Infrastructure and application releases share the
`production` concurrency group, so they cannot overlap.

An existing Lightsail instance and backup bucket must be imported before the
first apply. Applying against an empty state would try to create replacements:

```sh
terraform -chdir=infra/aws import aws_lightsail_instance.production <instance-name>
terraform -chdir=infra/aws import aws_s3_bucket.backups <bucket-name>
terraform -chdir=infra/aws import aws_s3_bucket_public_access_block.backups <bucket-name>
terraform -chdir=infra/aws import aws_s3_bucket_server_side_encryption_configuration.backups <bucket-name>
terraform -chdir=infra/aws import aws_s3_bucket_versioning.backups <bucket-name>
```

Import and reconcile the Docker resources separately. Never import a resource
and immediately apply without reviewing every replacement and confirming that
persistent volumes are no-op.

## Releases and migrations

A push to `master` publishes immutable application and PostgreSQL/WAL-G images,
discovers the current Lightsail IP, uploads runtime files, and applies only
`infra/production`. Images are pulled before Terraform changes containers.
PostgreSQL is excluded from routine restarts unless `restart_database=true` is
selected in a manual run.

If `db/migrations` differs from the revision recorded in Terraform state, an
automatic release stops before deployment. Review the SQL and rerun `Production`
for the same revision with `apply_migrations=true`. Migrations are forward-only
and are not automatically reversed.

The workflow verifies all ten containers, `/api/health`, and an API routing
probe. If Terraform apply or verification fails, it reapplies the previous image
references recorded in state. That rollback does not reverse database
migrations and does not change AWS infrastructure.

Routine releases create revision-and-run-specific `chat`, `donations`, and
`web` containers and wait for their Docker health checks before destroying the
previous containers. Their stable network aliases keep Caddy routing to healthy
instances throughout the change. Each event-processing `video` and `alerts`
worker is destroyed before its replacement starts so two revisions of that
worker cannot consume the same event concurrently. Caddy, Vector, WAL-G,
PostgreSQL, and NATS are not restarted solely because the application revision
changes.

When a changed runtime file must be reloaded by Caddy, Vector, or WAL-G, run the
workflow manually with `reload_runtime_services=true`. Use
`restart_database=true` only when PostgreSQL itself must be recreated; both are
explicit maintenance operations rather than routine release behavior.

## Validation and recovery

Validate all roots locally:

```sh
just fmt-check-terraform
just terraform-validate
just check
```

Prefer GitHub workflows for real plans and applies so backend locking, OIDC, and
environment configuration are identical to production.

Before a risky database or host change, run a fresh WAL-G base backup and verify
that it appears in `backup-list`. Regularly perform a restore test into a new,
empty volume; a successful upload is not a restore test. PostgreSQL 18 stores
its cluster beneath `/var/lib/postgresql`; never delete the volume as an upgrade
shortcut.

If Terraform deployment is unavailable, SSH to the host and use the checked-in
`compose.yaml` only as a temporary recovery path. Re-import any containers that
Compose replaces and require a zero-change Terraform plan before returning to
normal releases.
