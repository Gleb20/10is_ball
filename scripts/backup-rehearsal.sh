#!/usr/bin/env bash
# Tab-10 backup/restore rehearsal (NFR §7).
# Verifies pg_dump → restore into a throwaway DB without touching production data.
#
# Prerequisites:
#   - docker compose postgres running (see docker-compose.yml)
#   - pg_dump and psql on PATH (brew install libpq / postgresql client)
#
# Usage:
#   ./scripts/backup-rehearsal.sh
#   DATABASE_URL=postgres://tab10:tab10@localhost:5432/tab10 ./scripts/backup-rehearsal.sh

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://tab10:tab10@localhost:5432/tab10}"
RESTORE_DB="${RESTORE_DB:-tab10_restore_rehearsal}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/tab10-backup-rehearsal}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/tab10_${TIMESTAMP}.sql"

mkdir -p "${BACKUP_DIR}"

echo "==> Backup rehearsal: dump source DB"
pg_dump "${DATABASE_URL}" --no-owner --no-acl -f "${DUMP_FILE}"
echo "    Dump written: ${DUMP_FILE} ($(wc -c < "${DUMP_FILE}") bytes)"

BASE_URL="${DATABASE_URL%/*}"
ADMIN_URL="${BASE_URL}/postgres"

echo "==> Create throwaway restore DB: ${RESTORE_DB}"
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB};"
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${RESTORE_DB};"

RESTORE_URL="${BASE_URL}/${RESTORE_DB}"
echo "==> Restore dump into ${RESTORE_DB}"
psql "${RESTORE_URL}" -v ON_ERROR_STOP=1 -f "${DUMP_FILE}"

echo "==> Verify core tables exist"
TABLES="$(psql "${RESTORE_URL}" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"
for table in users matches tournaments auth_sessions; do
  if ! echo "${TABLES}" | grep -qx "${table}"; then
    echo "ERROR: missing table ${table} after restore" >&2
    exit 1
  fi
done
echo "    OK: users, matches, tournaments, auth_sessions"

echo "==> Cleanup throwaway DB"
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -c "DROP DATABASE ${RESTORE_DB};"

echo "==> Backup rehearsal passed"
