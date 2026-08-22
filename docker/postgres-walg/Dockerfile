FROM debian:bookworm-slim AS wal-g

ARG TARGETARCH
ARG WALG_VERSION=3.0.9

RUN apt-get update
RUN apt-get install --no-install-recommends --yes ca-certificates curl
RUN rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH}" in amd64) echo amd64 ;; arm64) echo aarch64 ;; *) echo "Unsupported WAL-G architecture: ${TARGETARCH}" >&2; exit 1 ;; esac > /tmp/walg_arch
RUN walg_arch="$(cat /tmp/walg_arch)"; asset="wal-g-pg-22.04-${walg_arch}.tar.gz"; curl --fail --location --silent --show-error --output "/tmp/${asset}" "https://github.com/wal-g/wal-g/releases/download/v${WALG_VERSION}/${asset}"
RUN walg_arch="$(cat /tmp/walg_arch)"; asset="wal-g-pg-22.04-${walg_arch}.tar.gz"; curl --fail --location --silent --show-error --output "/tmp/${asset}.sha256" "https://github.com/wal-g/wal-g/releases/download/v${WALG_VERSION}/${asset}.sha256"
RUN cd /tmp; sha256sum --check "wal-g-pg-22.04-$(cat /tmp/walg_arch).tar.gz.sha256"
RUN tar --extract --gzip --file "/tmp/wal-g-pg-22.04-$(cat /tmp/walg_arch).tar.gz" --directory /tmp
RUN install --mode=0755 "/tmp/wal-g-pg-22.04-$(cat /tmp/walg_arch)" /usr/local/bin/wal-g

FROM postgres:18

RUN apt-get update
RUN apt-get install --no-install-recommends --yes ca-certificates
RUN rm -rf /var/lib/apt/lists/*

COPY --from=wal-g /usr/local/bin/wal-g /usr/local/bin/wal-g
COPY backup-scheduler.sh /usr/local/bin/backup-scheduler
COPY pg_hba.conf /etc/postgresql/pg_hba.conf
