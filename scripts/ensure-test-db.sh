#!/bin/sh
# Makes sure the `db` container from docker-compose.yml exists, is running and healthy, and that
# the `library_test` database exists, before the integration tests run (wired up as the npm
# `pretest` / `pretest:integration` hooks). Safe to run repeatedly: when everything is already
# up it only does a couple of cheap checks.
#
# Usage: scripts/ensure-test-db.sh [--teardown]
#   --teardown   Drop `library_test` and recreate it empty, so the next test run migrates from
#                scratch. Same as TEARDOWN_TEST_DB=true (use the env var through npm, e.g.
#                `npm run test:fresh`, since npm hooks cannot take flags).
# Default: leave the database exactly as the last test run left it; the schema is only brought
# up to date by scripts/migrate-test-db.sh.
set -e

TEARDOWN="${TEARDOWN_TEST_DB:-false}"
for arg in "$@"; do
  case "$arg" in
    --teardown) TEARDOWN=true ;;
    *) echo "ensure-test-db: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

# CI provides its own Postgres service container (see .github/workflows/ci.yml); starting
# another one through docker compose would collide on port 5432.
if [ -n "$CI" ]; then
  echo "ensure-test-db: CI detected, skipping."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

DB_USER="${POSTGRES_USER:-library}"
TEST_DB="library_test"

if ! command -v docker >/dev/null 2>&1; then
  echo "ensure-test-db: docker is not installed or not on PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ensure-test-db: the Docker daemon is not reachable. Start Docker and retry." >&2
  exit 1
fi

# Creates the container if missing, starts it if stopped, and waits for its healthcheck.
# A no-op when it is already up and healthy.
echo "ensure-test-db: making sure the db container is up..."
docker compose up -d --wait db

# docker/init-test-db.sh only runs when the data volume is first created, so a volume that
# predates it (or was created by another setup) may lack the test database.
if [ "$TEARDOWN" = "true" ]; then
  echo "ensure-test-db: tearing down $TEST_DB..."
  docker compose exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)"
fi

exists="$(docker compose exec -T db psql -U "$DB_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$TEST_DB'")"
if [ "$exists" != "1" ]; then
  echo "ensure-test-db: creating database $TEST_DB..."
  docker compose exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE $TEST_DB"
fi

echo "ensure-test-db: ready."
