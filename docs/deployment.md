# Coldbrew production deployment

Production runs on a single VPS, but deployments are performed by the
`Production` GitHub Actions workflow. Every push to `master` is checked, built
as immutable `linux/amd64` images, published to GitHub Container Registry
(GHCR), and deployed over SSH. The VPS never builds application images during
a deployment.

The workflow publishes these public packages as immutable images:

- `ghcr.io/lebedev-nikita/coldbrew`, tagged with the full commit SHA;
- `ghcr.io/lebedev-nikita/coldbrew-postgres-walg`, tagged with the Git tree SHA
  of `docker/postgres-walg` so application-only changes do not restart the
  database.

The `Production` GitHub environment is the source of truth for application
configuration. Each deployment combines its individual GitHub Variables and
Secrets into the untracked `/opt/coldbrew/.env` on the VPS before running
Compose.

`apps/donationalerts` is a long-lived process. It keeps one outgoing WebSocket
connection per connected Coldbrew user and writes received donations to
PostgreSQL, so it must run as a persistent worker rather than as a serverless
function.

## Runtime layout

- `caddy` listens on TCP ports 80 and 443 and UDP port 443, terminates TLS,
  and proxies requests to `web:3000`.
- `web`, `donationalerts`, and `video` share one SHA-tagged GHCR image. Only
  `web` has an HTTP health check.
- `vector` reads the three application services' Docker logs and forwards them
  to the `coldbrew-logs` Axiom dataset. Infrastructure and Vector's own
  logs remain local.
- `postgres` stores data in the `postgres_data` volume. Application containers
  connect to `postgres:5432` through the private `internal` network. The host
  and remote PostgreSQL clients can reach it at `<VPS-IP>:${PGPORT:-5432}`.
- `wal-g` creates periodic base backups, while PostgreSQL continuously archives
  WAL files to the configured S3-compatible storage.
- All services use `restart: unless-stopped`. The app containers wait for a
  healthy PostgreSQL instance, and Caddy waits for a healthy web app.

Run only one `donationalerts` replica. The worker has no leader election, so
multiple replicas could subscribe and refresh tokens for the same users.

## One-time VPS setup

Install Git, Docker with the Compose plugin, Bun, `just`, `dotenvx`, `pgschema`,
and `curl`. Create a dedicated deployment user that can use Docker without
`sudo`, owns `/opt/coldbrew`, and can log in only with an SSH key. Clone the
public repository into that directory:

```sh
git clone https://github.com/lebedev-nikita/coldbrew.git /opt/coldbrew
cd /opt/coldbrew
```

Verify the runtime commands as that same deployment user, not as `root`:

```sh
git --version
docker compose version
just --version
bunx --version
curl --version
```

The workflow explicitly includes `~/.local/bin`, `~/.bun/bin`, `~/.cargo/bin`,
and `/usr/local/bin` for non-interactive SSH sessions.

Do not edit tracked files in this checkout. A deployment refuses to continue
when tracked local changes are present. The ignored `.env` and `.deployed-sha`
files are managed by the deployment workflow and are expected to change on the
server. Do not create or edit the production `.env` manually.

The GitHub Variables and Secrets described below provide:

- `APP_DOMAIN`, including the scheme, for example
  `https://coldbrew.example.com`;
- `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and optionally `PGPORT` for the
  external PostgreSQL binding (defaults to `5432`);
- `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`;
- `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` for multichat OAuth;
- `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, and `KICK_WEBHOOK_PUBLIC_KEY` for
  multichat OAuth and signed webhook verification;
- `DONATION_ALERTS_CLIENT_ID` and `DONATION_ALERTS_CLIENT_SECRET`;
- `AXIOM_TOKEN`, an ingest-only API token scoped to the `coldbrew-logs` dataset;
- `WALG_S3_PREFIX` and `AWS_REGION`, plus AWS credentials unless the VPS uses
  an IAM role or another supported credential provider.

Create the `coldbrew-logs` dataset in Axiom before the first deployment,
then create an API token that can only ingest into that dataset. The deployment
stores the token with the other production values in `.env`. Compose mounts it
as `/run/secrets/axiom_token`, and Vector resolves it through its directory
secrets backend. Vector sends events to the dataset's
`eu-central-1.aws.edge.axiom.co` edge deployment.

Production configuration, including credentials, is stored in the ignored
`.env` file on the VPS and passed to containers through environment variables.
Do not add Compose file secrets for these values: keeping one configuration
path ensures that `docker compose up` detects changes and recreates affected
containers. The deployment recipe also records the deployed immutable
`COLDBREW_IMAGE` and `COLDBREW_POSTGRES_IMAGE` references there, so later manual
Compose operations cannot fall back to stale local images. A rollback replaces
both references with the previous revision's images.

`localhost` has different meanings on the host and in a container. Host-side
tools use `PGHOST=127.0.0.1`; remote tools use the VPS address; application
containers must use `postgres` in `DATABASE_URL`. The workflow generates that
URL from `PGUSER`, `PGPASSWORD`, and `PGDATABASE`, safely URL-encoding each
component; do not add a separate `DATABASE_URL` secret.

For a new database volume, first run the `Production` workflow. Its schema gate
will stop the initial deployment, but the workflow will already have generated
`/opt/coldbrew/.env` from GitHub. Then start PostgreSQL, apply the schema using
the host-side port, and rerun the workflow with `schema_applied` enabled:

```sh
just compose-db-up
dotenvx run -f .env -- just schema-apply
```

Record the commit represented by the running database and application. This
becomes the base used by the CI schema gate:

```sh
git rev-parse HEAD > .deployed-sha
chmod 600 .deployed-sha
```

The first CI deployment cannot reliably roll back unless images for this base
SHA already exist in GHCR. Subsequent successful deployments always retain a
SHA-tagged rollback target.

Point the domain's DNS records to the VPS and allow TCP 80, 443, and 5432 plus
UDP 443 through its firewall and cloud-provider security group. If `PGPORT`
is set to another value, allow that TCP port instead of 5432. Register these
OAuth callback URLs:

- `https://<domain>/api/auth/callback/google`
- `https://<domain>/api/integration/donationalerts/callback`
- `https://<domain>/api/chat/oauth/youtube/callback`

PostgreSQL 18 keeps the cluster in a version-specific subdirectory under
`/var/lib/postgresql`; `compose.yaml` therefore mounts the volume at that
directory. When upgrading a PostgreSQL 17-or-earlier volume, migrate it with
`pg_dump`/`pg_restore` or `pg_upgrade`. Do not delete the old volume as an
upgrade shortcut.

## GitHub configuration

Use the existing GitHub environment named `Production`. Restrict its deployment
branches to `master`; do not add a required reviewer when deployments from
`master` should remain automatic.

Add these environment variables:

| Name                           | Example                            | Required |
| ------------------------------ | ---------------------------------- | -------- |
| `APP_DOMAIN`                   | `https://coldbrew.example.com`     | yes      |
| `AWS_ENDPOINT`                 | `https://s3.example.com`           | no       |
| `AWS_REGION`                   | `eu-central-1`                     | yes      |
| `DONATION_ALERTS_CLIENT_ID`    | `12345`                            | yes      |
| `GOOGLE_CLIENT_ID`             | OAuth client ID                    | yes      |
| `KICK_CLIENT_ID`               | Kick OAuth client ID               | yes      |
| `KICK_WEBHOOK_PUBLIC_KEY`      | Kick webhook RSA public key        | yes      |
| `YOUTUBE_CLIENT_ID`            | YouTube chat OAuth client ID       | yes      |
| `PGDATABASE`                   | `coldbrew`                         | yes      |
| `PGPORT`                       | `5432`                             | no       |
| `PGUSER`                       | `coldbrew`                         | yes      |
| `SSH_DEPLOY_PATH`              | `/opt/coldbrew`                    | yes      |
| `SSH_HOST`                     | `203.0.113.10`                     | yes      |
| `SSH_PORT`                     | `22`                               | yes      |
| `SSH_USER`                     | `coldbrew-deploy`                  | yes      |
| `WALG_ARCHIVE_TIMEOUT_SECONDS` | `300`                              | no       |
| `WALG_BACKUP_INTERVAL_SECONDS` | `86400`                            | no       |
| `WALG_KEEP_FULL_BACKUPS`       | `7`                                | no       |
| `WALG_S3_PREFIX`               | `s3://my-bucket/coldbrew/postgres` | yes      |

Add these environment secrets:

| Name                            | Value                                        | Required |
| ------------------------------- | -------------------------------------------- | -------- |
| `AWS_ACCESS_KEY_ID`             | Static AWS access key                        | no       |
| `AWS_SECRET_ACCESS_KEY`         | Static AWS secret key                        | no       |
| `AWS_SESSION_TOKEN`             | Temporary AWS session token                  | no       |
| `AXIOM_TOKEN`                   | Axiom ingest-only API token                  | yes      |
| `BETTER_AUTH_SECRET`            | At least 32 random characters                | yes      |
| `CHAT_SERVICE_SECRET`           | At least 32 random characters                | yes      |
| `CHAT_TOKEN_ENCRYPTION_SECRET`  | At least 32 random characters                | yes      |
| `DONATION_ALERTS_CLIENT_SECRET` | DonationAlerts OAuth client secret           | yes      |
| `GOOGLE_CLIENT_SECRET`          | Google OAuth client secret                   | yes      |
| `KICK_CLIENT_SECRET`            | Kick OAuth client secret                     | yes      |
| `YOUTUBE_CLIENT_SECRET`         | YouTube chat OAuth client secret             | yes      |
| `PGPASSWORD`                    | PostgreSQL password                          | yes      |
| `SSH_KNOWN_HOSTS`               | Verified `known_hosts` line for the VPS      | yes      |
| `SSH_PRIVATE_KEY`               | Private half of the dedicated deployment key | yes      |

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` must either both be set or both
be omitted when the VPS uses an IAM role or another supported credential
provider. The workflow validates this along with every required value, safely
generates dotenv syntax, transfers it over SSH, and atomically replaces
`/opt/coldbrew/.env` with mode `0600` on every deployment.

When a service gains a required server environment variable, update the
`Production` workflow in the same change: pass the GitHub variable or secret
to the environment-generation step, include it in its required-value list, and
add it to the VPS-side validation list. Document the corresponding GitHub
configuration here. Otherwise deployments can publish an image that fails its
health check because its generated `.env` is incomplete.

Generate `SSH_KNOWN_HOSTS` with `ssh-keyscan -p <port> <host>`, but verify the
reported host-key fingerprint through the VPS provider console before saving
it. Never replace this value merely because an unexpected SSH key is reported.

The repository is public, so the production images are public too. After the
first workflow publishes each GHCR package, open its package settings, change
visibility to public, and rerun the failed deployment job. No registry token is
then stored on the VPS.

Disconnect the old Vercel project from this GitHub repository and disable its
production and preview deployments. The `Production` environment is owned by
the GitHub Actions workflow after this migration.

## Regular deployments

A push or merge to `master` runs the complete workflow:

1. formatting, lint, type checking, and tests;
2. application and, when its source tree changed, PostgreSQL/WAL-G image builds;
3. immutable GHCR publication under the commit or source-tree SHA;
4. schema-gate check against `.deployed-sha`;
5. remote Compose pull, recreation, and health checks.

Only one production deployment runs at a time. Every attempt refreshes `.env`
from GitHub before checking the schema gate; a successful deployment writes the
target SHA to `/opt/coldbrew/.deployed-sha`. Named PostgreSQL and Caddy volumes
are preserved. Updating a production Variable or Secret and rerunning the
workflow recreates the affected containers with the new values; `docker compose
restart` alone does not refresh environment variables.

Useful checks on the VPS are:

```sh
docker compose ps
docker compose logs --tail=100 web donationalerts video postgres wal-g caddy
docker compose logs --tail=100 vector
```

Vector checks that the Axiom destination is reachable when it starts. A missing
`AXIOM_TOKEN` environment value prevents Vector from starting; an invalid token
is reported in Vector's logs when delivery is attempted. Neither failure prevents the application
services from running. After deployment, confirm that events arrive in Axiom's
`coldbrew-logs` dataset. Filter by `label.com.docker.compose.service` to
separate `web`, `donationalerts`, and `video`. Each event also includes its
Docker timestamp, container name, image, and stdout/stderr stream.

Vector keeps up to 256 MiB of unsent events in the `vector_data` volume during a
temporary Axiom or network outage. The source is still best-effort: an extended
outage, a full buffer, or Vector being stopped can leave some logs available
only through `docker compose logs`.

To rotate the Axiom credential, replace the `AXIOM_TOKEN` secret in the GitHub
`Production` environment and rerun the production workflow. The workflow
regenerates `.env`, and Compose recreates Vector with the new environment value.

## Database schema gate

CI never applies `db/schema.sql` to production. If the file differs between
`.deployed-sha` and the target commit, image publication succeeds but the
deployment job exits before changing containers.

Apply the exact blocked revision manually:

```sh
cd /opt/coldbrew
git fetch --prune --tags origin
git checkout --detach <target-sha>
just schema-apply
```

After it succeeds, open **Actions → Production → Run workflow**, set `revision`
to the same full SHA, enable `schema_applied`, and run it. Do not enable the
confirmation when schema application failed or was performed for another
revision.

## Rollback

When the new stack fails its Compose or public HTTP health check, CI checks out
the previous `.deployed-sha` and starts its SHA-tagged images automatically.
The failed SHA is not recorded as deployed.

To roll back manually, run the Production workflow with the previous SHA in
`revision`. If `db/schema.sql` differs, the schema gate blocks the rollback;
database changes are deliberately never reversed automatically. Decide and
perform the database recovery separately, then use `schema_applied` only after
the database is compatible with the chosen application revision.

## Backups

The `wal-g` service creates a base backup as soon as PostgreSQL is healthy and
then repeats every `WALG_BACKUP_INTERVAL_SECONDS` (24 hours by default). It
retains `WALG_KEEP_FULL_BACKUPS` full backups (7 by default) and the WAL needed
by them. `WALG_ARCHIVE_TIMEOUT_SECONDS` controls how often PostgreSQL forces a
WAL segment switch (5 minutes by default).

Use the tracked helper commands to operate backups:

```sh
just backup-now
just backup-list
just backup-verify
```

A successful upload is not sufficient proof of recoverability. Regularly test
a restore into a separate empty volume before relying on the backup setup.

## Current scaling constraints

The practical capacity depends on DonationAlerts rate limits, donation history,
PostgreSQL latency, and the number of simultaneously active streamers. Monitor
container memory and CPU, database latency and connections, WebSocket reconnect
rate, and WAL-G failures instead of treating a VPS size as a guaranteed user
limit.

The main known constraints in the current implementation are:

- the hourly history sync processes users sequentially but fetches every page
  of every user's lifetime donation history, despite the schema already having
  a `history_checkpoint` field;
- subscription startup is staggered by 50 ms, but there is no explicit
  concurrency limit or reconnect jitter;
- token refresh is not serialized per user across the worker and the web OAuth
  callback;
- the workers do not handle `SIGTERM` explicitly and expose no health endpoint
  or heartbeat;
- each process uses a PostgreSQL pool with a maximum of 10 connections, so
  PostgreSQL capacity must account for the web app and both workers;
- the video worker polls up to 100 unparsed donations every 2.5 seconds and
  processes them serially. A YouTube 429 leaves the donation pending for a
  later polling iteration, without a separate retry schedule or backoff.

Donation insertion already batches reconciled history, awaits live WebSocket
writes, keeps upstream donation IDs as text, and uses the database uniqueness
constraint as the final idempotency guard.
