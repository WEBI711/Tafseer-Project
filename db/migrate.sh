#!/usr/bin/env bash
# Apply every migration in db/migrations, in order, to the compose database.
# Safe to re-run: migrations are written with IF NOT EXISTS / idempotent updates.
#
#   ./db/migrate.sh
set -euo pipefail

container="${TAFSEER_DB_CONTAINER:-tafseer-db}"
user="${TAFSEER_DB_USER:-tafseer}"
db="${TAFSEER_DB_NAME:-tafseer}"
dir="$(cd "$(dirname "$0")" && pwd)/migrations"

if ! docker inspect -f '{{.State.Running}}' "$container" >/dev/null 2>&1; then
  echo "container '$container' is not running — start it with:" >&2
  echo "  docker compose up -d db" >&2
  exit 1
fi

for f in "$dir"/*.sql; do
  echo "applying $(basename "$f")"
  docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U "$user" -d "$db" < "$f"
done

echo "migrations applied"
