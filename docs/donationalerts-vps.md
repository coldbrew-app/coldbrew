# DonationAlerts worker on a VPS

`apps/donationalerts` is a long-lived WebSocket worker. It opens one outgoing
DonationAlerts connection per connected Coldbrew user and writes received
donations to Postgres. Deploy it as a persistent process, not a serverless
function.

## Recommended deployment

Deploy the complete runtime on a VPS using Docker Compose: `apps/web`,
`apps/donationalerts`, and `apps/video`. Caddy is the only public container; it
terminates TLS and proxies requests to the web container. The two workers have
no public HTTP ports: they only make outgoing connections and talk to Postgres.
Configure a restart policy so containers are restarted after a process or host
failure.

Use a managed/serverless Postgres instance. Its pooled, TLS-enabled connection
URL is supplied as `DATABASE_URL` to every application container. The Compose
stack deliberately does not include a database service.

Use the tracked deployment files as follows:

1. Copy decrypted `.env.prod` to `/opt/coldbrew/.env` on the VPS and fill in
   the production values. Keep this unencrypted file readable only by the
   deployment user and never commit it. Compose passes its values to the app
   containers at runtime; the Docker image contains no environment file.
2. Point the domain's DNS records at the VPS and permit ports 80 and 443.
3. Configure the GitHub Actions deployment host and SSH secrets. Application
   configuration, including the domain, remains only in the VPS `.env` file.
4. Register `https://<domain>/api/auth/callback/google` with Google and
   `https://<domain>/api/integration/donationalerts/callback` with
   DonationAlerts.

The `deploy.yml` workflow publishes immutable GHCR images and deploys them by
SSH. The VPS needs a one-time `docker login ghcr.io` using a read-only package
token. Subsequent deployments upload the tracked `compose.yaml` and `Caddyfile`
before replacing containers. The image is environment-independent, while the
VPS `.env` supplies its runtime configuration.

Run a single worker replica. Before adding a second replica, introduce a
Postgres advisory lock (or equivalent leader election) so only one instance
owns subscriptions and refreshes tokens at a time.

## Capacity estimate

The estimate below assumes a typical $5 VPS: 1 vCPU, 1 GB RAM and 20--25 GB
SSD. It describes users with a connected DonationAlerts integration, because
each one has an open WebSocket; it is not a limit on all registered users.

| Deployment                                                   |                               Conservative starting capacity |
| ------------------------------------------------------------ | -----------------------------------------------------------: |
| DonationAlerts worker only, Postgres elsewhere               |                                     300--500 connected users |
| DonationAlerts and video workers, Postgres elsewhere         |                                     150--300 connected users |
| Web app, both workers, and Postgres on the same VPS          | 50--100 connected users; 1 GB RAM is not a production target |
| 2 vCPU / 4 GB with Postgres elsewhere, after the fixes below |                                       1,000+ connected users |

These are operating targets, not guarantees. DonationAlerts API limits,
historical donation volume, the number of simultaneously active streamers, and
Postgres latency determine the real limit. Confirm it with a load test and
monitor resident memory, CPU, DB latency, connection count, and reconnect
rate.

WebSocket handling is inexpensive in the current code: each user has one
client plus small in-memory bookkeeping, and each received donation does
validation and an insert. The current scale limit is instead the REST
reconciliation and unbounded database writes.

## Required changes before growth

### Make history reconciliation incremental

The daily job synchronizes users sequentially and `getDonations` traverses all
pages of a user's history. Every page after the first also waits 250 ms. This
makes run time grow with both the number of users and their lifetime donation
history.

Store a per-user checkpoint, or stop after encountering an already-persisted
DonationAlerts ID. Keep the unique database constraint as the final
idempotency guard, but do not fetch the entire history every day.

### Batch and retry database writes

The WebSocket handler currently starts `insertDonations` without awaiting it.
A donation burst can create an unbounded number of concurrent Postgres queries
and errors are not retried. Put received events into a bounded in-memory queue,
flush small batches, and retry transient database failures with backoff. Expose
queue depth as a metric.

### Avoid reconnect and token-refresh races

On startup, establish subscriptions with a concurrency limit and jitter.
Otherwise a restart reconnects every user simultaneously. Serialize OAuth token
refresh per user because the web OAuth callback and worker can otherwise
overwrite one another's refresh tokens.

### Handle termination and observe liveness

On `SIGTERM`, stop opening subscriptions, close existing sockets, flush the
write queue within a short deadline, and exit. Record a worker heartbeat in
Postgres or expose a health endpoint and alert when it is stale.

### Bound database resources

Set explicit small Postgres connection-pool limits for worker processes and
size Postgres `max_connections` accordingly. Do not rely on implicit driver
defaults when the web app and both workers use the same database.

### Keep donation IDs as text

The database schema stores `donation.origin_donation_id` as `text`, while the
DonationAlerts worker decodes it as `int` during insertion. Decode it as
`text`, matching the schema and domain model, so large upstream IDs cannot
overflow a 32-bit integer.

## Video worker note

`apps/video` polls every 2.5 seconds and processes YouTube URLs serially. Its
limit is generally YouTube latency and rate limiting rather than CPU. A 429
currently leaves the donation unparsed, so the next polling iteration tries it
again; add a retry schedule/backoff before putting a large volume of video
links through the same VPS.
