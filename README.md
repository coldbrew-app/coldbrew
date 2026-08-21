# Coldbrew

Bun TypeScript monorepo with a TanStack Start/tRPC/Postgres web app and dedicated donation/video polling workers.

Project tasks are managed with [just](https://just.systems/). Run `just` to list them.

## Globally required utilities

- [Bun](https://bun.com/docs/installation) — runs the project and its package scripts.
- [just](https://just.systems/) — task runner.
- [dotenvx](https://dotenvx.com/) — loads and encrypts environment files.
- [pgschema](https://github.com/pgschema/pgschema) — applies and resets the database schema.
- [cloc](https://github.com/AlDanial/cloc) — counts repository lines of code.

## Start locally

Install [Bun](https://bun.com/docs/installation), then run:

```sh
just install
just dev
```

Configure `.env.dev` with a reachable PostgreSQL instance before starting the
app. The client runs at `http://localhost:3000`, including the web UI,
authentication, tRPC API, and OAuth callbacks.

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
just schema-apply
just compose-up
```

PostgreSQL data is retained in the `postgres_data` Docker volume. Its port is
bound to `127.0.0.1`, so host-side tools such as `pgschema` can connect while
the database remains unavailable from the network.

PostgreSQL 18 stores database clusters in a version-specific subdirectory of
that volume. If upgrading an existing PostgreSQL 17-or-earlier volume, migrate
the database with `pg_dump`/`pg_restore` (or `pg_upgrade`) before starting the
PostgreSQL 18 container; do not delete the old volume until the migration is
verified.
