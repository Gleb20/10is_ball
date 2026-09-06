#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
exec node scripts/audit/secret-scan.mjs "$@"
