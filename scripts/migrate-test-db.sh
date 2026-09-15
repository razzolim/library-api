#!/bin/sh
# Rebuilds the library_test database from the Liquibase changelog. Run before the Vitest suite
# (see tests/global-setup.js) so every test run starts from a known-empty schema, the same
# guarantee `prisma db push --force-reset` gave under Prisma Migrate. drop-all + update (rather
# than update alone) is needed because this project edits its existing changesets in place while
# pre-release (see CLAUDE.md) instead of layering new ones on top, which Liquibase's checksum
# tracking would otherwise flag as a conflict.
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
  -c "liquibase drop-all --force && liquibase update"
