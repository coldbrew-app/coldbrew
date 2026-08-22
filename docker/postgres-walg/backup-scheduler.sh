#!/bin/sh

set -eu

: "${WALG_BACKUP_INTERVAL_SECONDS:=86400}"
: "${WALG_KEEP_FULL_BACKUPS:=7}"

postgres_data_directory="${1:?Pass the PostgreSQL data directory as the first argument}"

case "${WALG_BACKUP_INTERVAL_SECONDS}" in
  '' | *[!0-9]*)
    echo 'WALG_BACKUP_INTERVAL_SECONDS must be a positive integer' >&2
    exit 1
    ;;
esac

case "${WALG_KEEP_FULL_BACKUPS}" in
  '' | *[!0-9]*)
    echo 'WALG_KEEP_FULL_BACKUPS must be a positive integer' >&2
    exit 1
    ;;
esac

if [ "${WALG_BACKUP_INTERVAL_SECONDS}" -lt 1 ] || [ "${WALG_KEEP_FULL_BACKUPS}" -lt 1 ]; then
  echo 'WAL-G backup interval and retention must be greater than zero' >&2
  exit 1
fi

while true; do
  wal-g backup-push "${postgres_data_directory}"
  wal-g delete retain FULL "${WALG_KEEP_FULL_BACKUPS}" --confirm
  sleep "${WALG_BACKUP_INTERVAL_SECONDS}"
done
