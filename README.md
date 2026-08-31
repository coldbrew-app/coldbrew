# Coldbrew

Bun TypeScript monorepo with a TanStack Start/tRPC/Postgres web app and dedicated chat, donation, and video services.

See [currency and video-queue rules](docs/currencies.md) for the fixed exchange
rates and queue-currency transition semantics.
See [multichat](docs/multichat.md) for the multi-provider chat service, OAuth credentials, moderation, and OBS tokens.

Project tasks are managed with [just](https://just.systems/). Run `just` to list them.

## Globally required utilities

- [Bun](https://bun.com/docs/installation) — runs the project and its package scripts.
- [just](https://just.systems/) — task runner.
- [dotenvx](https://dotenvx.com/) — loads and encrypts environment files.
- [PostgreSQL client](https://www.postgresql.org/download/) — provides `psql` for data migrations.
- [pgschema](https://github.com/pgschema/pgschema) — applies and resets the database schema.
- [cloc](https://github.com/AlDanial/cloc) — counts repository lines of code.

## Start locally

Install [Bun](https://bun.com/docs/installation), then run:

```sh
just install
just env-init
just dev-db-up
just schema-apply
just dev
```

`.env.dev` is the encrypted, long-lived source for development secrets.
`just env-init` decrypts it into the gitignored `.env` runtime configuration
and assigns the current worktree its own application port, PostgreSQL port,
database name, and Docker Compose project. It requires the development key in
`.env.keys`. Worktrunk copies that key from the primary worktree when it creates
a new worktree.

The application URL is stored in `APP_DOMAIN` in the generated `.env`. It
serves the web UI and authentication. `/api/chat/*` is routed to the chat
microservice, including provider OAuth callbacks and the direct browser tRPC
connection. Each worktree created through Worktrunk initializes its environment and database,
copies a consistent snapshot of the development database from the worktree of
its base branch, applies its schema, and starts its development processes
automatically. The base worktree and its development database must already be
running; database-copy failures abort the Worktrunk setup instead of falling
back to an empty database.

The development PostgreSQL volume is retained by `just dev-db-down`. Remove
it explicitly with `just dev-db-destroy` when its data is no longer needed.
Worktrunk runs the destructive command automatically before removing a
worktree.

## Run the complete stack with Docker Compose

Create a decrypted, untracked `.env` file with `PGHOST=127.0.0.1`,
`PGPORT=5432`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD`. Set `DATABASE_URL`
to the same database using the Docker hostname `postgres`, for example:

```sh
DATABASE_URL=postgresql://coldbrew:password@postgres:5432/coldbrew
```

For a new database volume, start PostgreSQL and apply the schema before
starting the application services:

```sh
just compose-db-up
dotenvx run -f .env -- just schema-apply
just compose-up
```

PostgreSQL data is retained in the `postgres_data` Docker volume. Its port is
bound to `127.0.0.1`, so host-side tools such as `pgschema` can connect while
the database remains unavailable from the network.

### PostgreSQL backups in S3

Docker Compose continuously archives PostgreSQL WAL files to S3 with WAL-G and
starts a base backup every 24 hours. Add these settings to the untracked `.env`
file before starting the stack:

```sh
WALG_S3_PREFIX=s3://my-bucket/coldbrew/postgres
AWS_REGION=eu-central-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Optional: required for S3-compatible storage such as MinIO.
# AWS_ENDPOINT=http://minio:9000

# Optional defaults shown.
# WALG_ARCHIVE_TIMEOUT_SECONDS=300
# WALG_BACKUP_INTERVAL_SECONDS=86400
# WALG_KEEP_FULL_BACKUPS=7
```

An IAM role may be used instead of static AWS credentials; in that case omit
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The role needs permissions to
list, read, write, and delete objects under `WALG_S3_PREFIX`.

The `wal-g` service creates an initial base backup as soon as PostgreSQL is
healthy, then repeats according to `WALG_BACKUP_INTERVAL_SECONDS`. It retains
the newest `WALG_KEEP_FULL_BACKUPS` full backups and the WAL needed by them.
Use these helper commands to operate it:

```sh
just backup-now       # create a base backup immediately
just backup-list      # list available base backups
just backup-verify    # check that the WAL chain supports PITR
```

To restore, stop the stack, restore a chosen base backup into an empty
PostgreSQL data directory with `wal-g backup-fetch`, create `recovery.signal`,
and start PostgreSQL with `restore_command='/usr/local/bin/wal-g wal-fetch %f %p'`.
Practice this procedure against a separate volume before relying on the backup.

PostgreSQL 18 stores database clusters in a version-specific subdirectory of
that volume. If upgrading an existing PostgreSQL 17-or-earlier volume, migrate
the database with `pg_dump`/`pg_restore` (or `pg_upgrade`) before starting the
PostgreSQL 18 container; do not delete the old volume until the migration is
verified.
