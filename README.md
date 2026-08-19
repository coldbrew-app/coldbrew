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
cp .env.example .env
just install
just dev
```

Before starting the app, install and start PostgreSQL locally, then create the
database named in `DATABASE_URL` (by default, `coldbrew`). The client runs at
`http://localhost:3000`, including the web UI, authentication, tRPC API, and OAuth callbacks.
