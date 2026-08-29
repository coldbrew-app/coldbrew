# Coldbrew on a VPS

Coldbrew is deployed from a Git checkout on the VPS. Docker Compose builds the
application image locally and runs the web app, the DonationAlerts and video
workers, PostgreSQL, WAL-G, and Caddy. A regular deployment is:

```sh
git pull && just compose-up
```

`apps/donationalerts` is a long-lived process. It keeps one outgoing WebSocket
connection per connected Coldbrew user and writes received donations to
PostgreSQL, so it must run as a persistent worker rather than as a serverless
function.

## Runtime layout

- `caddy` listens on TCP ports 80 and 443 and UDP port 443, terminates TLS,
  and proxies requests to `web:3000`.
- `web`, `donationalerts`, and `video` share the locally built
  `coldbrew:local` image. Only `web` has an HTTP health check.
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

Install Git, Docker with the Compose plugin, Bun, `just`, `dotenvx`, and
`pgschema`. Clone the repository into its permanent directory, for example
`/opt/coldbrew`, and run all commands below from that directory.

Create an untracked `/opt/coldbrew/.env`. One way to initialize it when the
production decryption key is available is:

```sh
dotenvx decrypt -f .env.prod --stdout > .env
chmod 600 .env
```

The file must contain:

- `APP_DOMAIN`, including the scheme, for example
  `https://coldbrew.example.com`;
- `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and optionally `PGPORT` for the
  external PostgreSQL binding (defaults to `5432`);
- `DATABASE_URL` with the Compose hostname, for example
  `postgresql://coldbrew:password@postgres:5432/coldbrew`;
- `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`;
- `DONATION_ALERTS_CLIENT_ID` and `DONATION_ALERTS_CLIENT_SECRET`;
- `WALG_S3_PREFIX` and `AWS_REGION`, plus AWS credentials unless the VPS uses
  an IAM role or another supported credential provider.

`localhost` has different meanings on the host and in a container. Host-side
tools use `PGHOST=127.0.0.1`; remote tools use the VPS address; application
containers must use `postgres` in `DATABASE_URL`. Do not put `localhost` in
the containers' `DATABASE_URL`.

For a new database volume, start PostgreSQL, apply the schema using the
host-side port, and then start the complete stack:

```sh
just compose-db-up
dotenvx run -f .env -- just schema-apply
just compose-up
```

Point the domain's DNS records to the VPS and allow TCP 80, 443, and 5432 plus
UDP 443 through its firewall and cloud-provider security group. If `PGPORT`
is set to another value, allow that TCP port instead of 5432. Register these
OAuth callback URLs:

- `https://<domain>/api/auth/callback/google`
- `https://<domain>/api/integration/donationalerts/callback`

PostgreSQL 18 keeps the cluster in a version-specific subdirectory under
`/var/lib/postgresql`; `compose.yaml` therefore mounts the volume at that
directory. When upgrading a PostgreSQL 17-or-earlier volume, migrate it with
`pg_dump`/`pg_restore` or `pg_upgrade`. Do not delete the old volume as an
upgrade shortcut.

## Deploying updates

Deploy from the checkout on the VPS:

```sh
cd /opt/coldbrew
git pull && just compose-up
```

`just compose-up` runs `docker compose up --build -d`: it rebuilds the local
application image and recreates changed services while preserving the named
PostgreSQL and Caddy volumes. It does not apply `db/schema.sql`. When an update
changes the schema, apply it explicitly before starting code that depends on
it:

```sh
dotenvx run -f .env -- just schema-apply
just compose-up
```

If `.env` changes, `just compose-up` recreates affected containers and loads
the new values. A plain `docker compose restart` does not refresh environment
variables injected when a container was created.

Useful checks after deployment:

```sh
docker compose ps
docker compose logs --tail=100 web donationalerts video postgres wal-g caddy
```

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
