# Coldbrew

Coldbrew is a Bun/TypeScript and Go monorepo for a streaming dashboard. The
TanStack Start web application uses tRPC and PostgreSQL; separate Go services
collect chat and donations and turn supported links from donation messages into
videos.

Project tasks are managed with [just](https://just.systems/). Run `just` to
list them.

Related documentation:

- [currency and video-queue rules](docs/currencies.md);
- [multichat architecture and provider setup](docs/multichat.md);
- [production deployment, configuration, and backups](docs/deployment.md).

## GitHub automation

The `Translate Russian issues` workflow translates newly opened Russian Issues
to English with the OpenAI API and adds the original Russian title and
description as a comment. Add `OPENAI_API_KEY__TRANSLATE` as a repository
Actions secret before enabling the workflow. The key is used only by that
workflow and is not written to its logs.

## Development prerequisites

Install these tools on the host:

- [Bun](https://bun.com/docs/installation) for the TypeScript workspace;
- Go 1.27.1, as declared by `go.mod`, for the Go services;
- [just](https://just.systems/) for repository tasks;
- Docker with the Compose plugin for PostgreSQL and NATS;
- [pgschema](https://github.com/pgschema/pgschema) to apply `db/schema.sql`;
- [ripgrep](https://github.com/BurntSushi/ripgrep) for the Go lint task.

`just install` installs workspace tools such as `dotenvx`; they do not need a
separate global installation. `cloc` is only needed for the optional
`just count-lines` task. The repository's normal setup and migration tasks do
not require a host-side PostgreSQL client.

## Start locally

The tracked `.env.dev` is the encrypted source for development settings. Obtain
the matching, untracked `.env.keys` file before initializing the environment.
Then run:

```sh
just install
just env-init
just dev-db-up
just schema-apply
just dev
```

`just env-init` decrypts `.env.dev` into the gitignored `.env` file. All
worktrees share one repository-wide PostgreSQL and NATS Compose stack, while
each worktree receives its own application and service ports, PostgreSQL
database, and NATS namespace. `just dev-db-up` starts the shared infrastructure
when necessary and creates the current worktree's database. `just dev` starts
the web, chat, donations, and video processes.

The local application URL is the `APP_DOMAIN` value written to `.env`.
Authentication and the web UI use that origin, and `/api/chat/*` is handled by
the web application before permitted requests are forwarded to the chat
service.

T3 Code's setup action in `t3.json` runs
`just t3-worktree-init "$T3CODE_PROJECT_ROOT"`. It copies `.env.keys` from the
primary checkout, initializes the worktree environment, installs dependencies,
starts the shared development infrastructure, creates and copies the
worktree's database from the primary checkout, and applies the schema. The same
recipe can be run manually with the source worktree path. The source worktree must have an
initialized `.env` and a running development PostgreSQL container; a copy
failure stops setup. Run `just dev` after the worktree is ready to start the
application processes.

Remove only the current worktree's database and NATS namespace with:

```sh
just dev-worktree-destroy
```

This leaves the shared containers and every other worktree untouched. Run it
before deleting a worktree when its local development data is no longer needed.
`just dev-infra-down` stops the shared containers while retaining all data;
`just dev-infra-destroy` removes the shared volumes and therefore requires
confirmation because it affects every worktree.

## Production

Production is deployed to a VPS by the `Production` GitHub Actions workflow.
It builds immutable application and PostgreSQL/WAL-G images, generates the
server's untracked `.env` from the GitHub `Production` environment, deploys the
Compose stack, and verifies its health. Do not replace that environment with a
hand-written subset of variables: the complete setup, first-deployment, schema,
rollback, networking, and backup guidance lives in
[the deployment guide](docs/deployment.md).

PostgreSQL continuously archives WAL files to the configured S3-compatible
storage, while the `wal-g` service creates and retains periodic base backups.
The production host provides these operational tasks:

```sh
just backup-now
just backup-list
just backup-verify
```

A successful upload or verification command is not a restore test. Regularly
test recovery into a separate empty volume before relying on the backups.
