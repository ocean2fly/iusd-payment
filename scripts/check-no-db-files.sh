#!/usr/bin/env bash
set -euo pipefail

# Fail if runtime data files are tracked by git.
# Keeps DB artifacts out of GitHub.

cd "$(git rev-parse --show-toplevel)"

PATTERN='(^packages/api/data/.*\.(db|db-wal|db-shm|sqlite|sqlite3)$)|(^data/.*\.(db|db-wal|db-shm|sqlite|sqlite3)$)|(^db-backups/.*\.(db|db-wal|db-shm|sqlite|sqlite3|sql)$)|(^packages/api/db-backups/.*\.(db|db-wal|db-shm|sqlite|sqlite3|sql)$)|(^.*\.(db|db-wal|db-shm|sqlite|sqlite3)$)'
TRACKED=$(git ls-files | grep -E "$PATTERN" || true)

if [[ -n "$TRACKED" ]]; then
  echo "❌ Tracked DB/runtime data files found (must not be committed):"
  echo "$TRACKED"
  echo
  echo "Fix:"
  echo "  1) Ensure .gitignore covers these paths"
  echo "  2) Remove from index (keeps local file): git rm --cached <path>"
  exit 1
fi

echo "✅ No tracked DB/runtime data files."
