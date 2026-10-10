#!/bin/sh
# Brings the library_test database up to date with the Liquibase changelog. Run before the Vitest
# suite (see tests/global-setup.js). It only applies pending changesets and keeps existing data
# as the last run left it. To start from an empty database (which also proves the whole chain
# applies cleanly), tear it down first: `npm run test:fresh` or `scripts/ensure-test-db.sh
# --teardown`. Applied changesets are immutable (see CLAUDE.md), so `update` alone is enough; if
# Liquibase reports a checksum validation error on a stale local database, run `npm run test:fresh`.
#
# Uses --network host so Liquibase can reach the Postgres container via localhost:5432 (the
# published port from docker-compose.yml) without relying on Docker's compose network DNS,
# which is not available in all environments.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

docker run --rm \
  --network host \
  --entrypoint sh \
  -w /liquibase/changelog \
  -e LIQUIBASE_COMMAND_URL="jdbc:postgresql://localhost:5432/library_test" \
  -e LIQUIBASE_COMMAND_USERNAME="${POSTGRES_USER:-library}" \
  -e LIQUIBASE_COMMAND_PASSWORD="${POSTGRES_PASSWORD:-library}" \
  -e LIQUIBASE_COMMAND_CHANGELOG_FILE=changelog-master.yaml \
  -v "$REPO_ROOT/liquibase:/liquibase/changelog" \
  liquibase/liquibase:4.29-alpine \
  -c "liquibase update"
