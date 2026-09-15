# ADR-0004: Migration Tooling — Prisma Migrate to Liquibase

## Status

Accepted — 2026-08-15, at explicit user request. Supersedes the migration-tooling half of
[ADR-0001](ADR-0001-backend-technology-stack.md)'s "ORM / migrations / seeding: Prisma" choice.
Prisma stays for everything else (schema modeling, generated client, query API, seeding) — only
schema migrations move to a different tool. Since this project has no deployment history yet (see
CLAUDE.md), the prior migration history was dropped rather than translated changeset-by-changeset.

## Context

Prisma Migrate stores migrations as a folder per change, each folder named
`<UTC-timestamp>_<name>/migration.sql`, tracked via a `_prisma_migrations` table. That format was
fine for the SQLite-era MVP, but the user asked specifically for a changelog-of-changesets model
(à la Liquibase) instead of timestamp-named folders — a single changelog file that declaratively
lists changesets, each independently identified, checksummed, and (optionally) reversible via a
paired rollback statement. Prisma Migrate has no such mode; getting it means using a different
tool for the migration step while keeping Prisma Client for everything else.

## Decision

- **Liquibase** owns schema migrations. `prisma/migrations/` is deleted; `prisma/schema.prisma`
  remains as the source Prisma Client generates from, but it is now hand-kept in sync with the
  Liquibase changesets (same manual-sync discipline CLAUDE.md already required between
  `schema.prisma` and `migration.sql` — just with a different file on the other side).
- Migrations live in `liquibase/`:
  - `liquibase/changelog-master.yaml` — the root changelog. Uses `includeAll` to pull in every
    file under `liquibase/changesets/`, so adding a changeset is "add a file," not "edit the
    master list."
  - `liquibase/changesets/NNN-<name>.sql` — one file per table, using Liquibase's
    [SQL formatted changelog](https://docs.liquibase.com/concepts/changelogs/sql-format.html)
    syntax (`--changeset <author>:<id>` comments), each with a `--rollback` statement.
- **Liquibase runs via its official Docker image**, not a local/JVM install — consistent with how
  Postgres itself only runs via `docker-compose.yml` (ADR-0003). A `liquibase` service is added to
  `docker-compose.yml`; `docker compose up` now runs it to completion (`condition:
  service_completed_successfully`) before starting `api`, replacing the `prisma migrate deploy`
  step that used to run inside the `api` container's `CMD`.
- `npm run db:migrate` wraps `docker compose run --rm liquibase update` for host-based dev.
- Tests: `tests/global-setup.js` now shells out to `scripts/migrate-test-db.sh`, which does a
  `drop-all` + `update` against `library_test` on every run — the Liquibase equivalent of the old
  `prisma db push --force-reset`, needed for the same reason (this project amends its one existing
  changeset set in place per CLAUDE.md's pre-release-squashing rule, rather than layering new
  changesets on top, so a full rebuild-from-empty is what makes checksum mismatches a non-issue
  locally).

## Alternatives Considered

- **Keep Prisma Migrate, only rename folders to look changelog-like.** Rejected — Prisma has no
  concept of a changeset registry, checksums, or per-change rollback; renaming folders wouldn't
  actually provide any of what a changelog format is for.
- **Flyway instead of Liquibase.** Both are Java-based SQL migration tools with a similar Docker
  story. Liquibase was chosen only because it's what the user asked for by name; nothing here
  would have been architecturally different with Flyway.
- **Install the Liquibase CLI locally (Homebrew/apt) instead of Docker.** Rejected for the same
  reason ADR-0003 chose dockerized Postgres over a local install — it keeps "clone and run" working
  without asking every contributor to have a JVM available.

## Consequences

**Positive**

- Changesets are individually identified and checksummed; each has an explicit `--rollback`.
- No local Java/Liquibase install required — same "Docker is the only prerequisite" story as the
  database itself.
- `docker compose up` now applies migrations automatically as a first-class step, rather than
  migrations being buried in the `api` container's startup command.

**Negative / trade-offs accepted**

- Two schema descriptions must now be kept in sync by hand: `prisma/schema.prisma` (for the
  generated client) and `liquibase/changesets/*.sql` (for the actual DDL). Previously Prisma
  Migrate generated migration SQL from schema changes; that generation step is gone; whoever
  changes the schema must hand-write both sides.
- Running any migration (dev or test) now requires Docker even when the API itself runs on the
  host via `npm run dev` — a `docker compose run` invocation, not a local `npx` command.
- Prior migration history was deleted rather than ported, per explicit instruction from the user
  — acceptable only because this project has no deployment history yet (CLAUDE.md).

## References

- [`ADR-0001-backend-technology-stack.md`](ADR-0001-backend-technology-stack.md) — original
  Prisma Migrate choice.
- [`ADR-0003-database-postgresql-migration.md`](ADR-0003-database-postgresql-migration.md) — the
  Postgres-via-docker-compose setup this migration tooling now hooks into.
- `liquibase/changelog-master.yaml`, `liquibase/changesets/` — the resulting changelog.
