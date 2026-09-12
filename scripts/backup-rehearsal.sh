#!/usr/bin/env bash
# Tab-10 backup/restore rehearsal (NFR §7).
# Verifies pg_dump → restore into a throwaway DB without touching production data.
#
# Prerequisites:
#   - docker compose postgres running (see docker-compose.yml)
#   - pg_dump and psql on PATH (brew install libpq / postgresql client)
#
# Usage:
#   BACKUP_REHEARSAL_CONFIRM=1 \
#   DATABASE_URL='<loopback PostgreSQL test database URL>' \
#   ./scripts/backup-rehearsal.sh

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set explicitly; never rely on a fallback}"
: "${BACKUP_REHEARSAL_CONFIRM:?Set BACKUP_REHEARSAL_CONFIRM=1 after checking the disposable local target}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tab10-backup-rehearsal.XXXXXX")"
RESTORE_SUFFIX="$(basename "${BACKUP_DIR}" | tr -cd '[:alnum:]_')"
RESTORE_DB="${RESTORE_DB:-tab10_restore_rehearsal_${RESTORE_SUFFIX}}"
DUMP_FILE="${BACKUP_DIR}/tab10.sql"
ADMIN_URL=""
RESTORE_URL=""
RESTORE_CREATED=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "${RESTORE_CREATED}" == "1" && -n "${ADMIN_URL}" ]]; then
    psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -v restore_db="${RESTORE_DB}" \
      <<< 'DROP DATABASE IF EXISTS :"restore_db" WITH (FORCE);' >/dev/null || true
  fi
  rm -f -- "${DUMP_FILE}"
  rmdir -- "${BACKUP_DIR}" 2>/dev/null || true
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ADMIN_URL="$(node "${SCRIPT_DIR}/ops-safety.mjs" backup-admin-url \
  "${DATABASE_URL}" "${RESTORE_DB}" "${BACKUP_REHEARSAL_CONFIRM}")"
RESTORE_URL="$(node "${SCRIPT_DIR}/ops-safety.mjs" backup-restore-url \
  "${DATABASE_URL}" "${RESTORE_DB}" "${BACKUP_REHEARSAL_CONFIRM}")"

echo "==> Backup rehearsal: dump source DB"
pg_dump --no-owner --no-acl --file "${DUMP_FILE}" "${DATABASE_URL}"
echo "    Dump written: ${DUMP_FILE} ($(wc -c < "${DUMP_FILE}") bytes)"

echo "==> Create throwaway restore DB: ${RESTORE_DB}"
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -v restore_db="${RESTORE_DB}" \
  <<< 'CREATE DATABASE :"restore_db";'
RESTORE_CREATED=1

echo "==> Restore dump into ${RESTORE_DB}"
psql "${RESTORE_URL}" -v ON_ERROR_STOP=1 -f "${DUMP_FILE}"

echo "==> Verify core tables exist"
TABLES="$(psql "${RESTORE_URL}" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"
for table in users matches tournaments auth_sessions; do
  if ! grep -qx "${table}" <<<"${TABLES}"; then
    echo "ERROR: missing table ${table} after restore" >&2
    exit 1
  fi
done
echo "    OK: users, matches, tournaments, auth_sessions"

echo "==> Cleanup throwaway DB"
psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -v restore_db="${RESTORE_DB}" \
  <<< 'DROP DATABASE :"restore_db" WITH (FORCE);'
RESTORE_CREATED=0

echo "==> Backup rehearsal passed"
