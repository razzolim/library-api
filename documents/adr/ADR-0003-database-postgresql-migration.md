# ADR-0003: Database — SQLite to PostgreSQL

## Status

Accepted — 2026-08-15. Supersedes the "Database" row of
[ADR-0001](ADR-0001-backend-technology-stack.md)'s decision table (the rest of that ADR — Express,
Prisma, JWT, bcryptjs, Vitest — is unaffected).

## Context

ADR-0001 chose SQLite for the MVP specifically because the dataset was tiny (1 demo user, 12
books) and a database server was infrastructure the MVP didn't need yet. It explicitly deferred
rather than discarded PostgreSQL, flagging in its own "Consequences" section: *"SQLite is not
suited for high-concurrency multi-writer production workloads — acceptable for an MVP demo but a
real migration to PostgreSQL will be needed before any serious concurrent-write usage (e.g., many
readers borrowing/returning books simultaneously)."*

Section 9 of `documents/backend-api-specification.md` (book CRUD, borrow/return, `/me`,
`/refresh`) is the next slice of work, and borrow/return is exactly the concurrent-write pattern
ADR-0001 called out. Moving to PostgreSQL now, ahead of implementing those endpoints, avoids
building borrow/return logic against a datastore that already has a known concurrency ceiling and
then having to migrate under it.

This also moves the project from "runs off a single file" to needing a real running database
server for local dev and deployment, which is the trigger for the docker-compose setup introduced
alongside this ADR (see `docker-compose.yml`).

## Decision

Switch the Prisma `datasource` from `sqlite` to `postgresql`. Concretely:

- `prisma/schema.prisma`: `datasource db { provider = "postgresql" ... }`.
- The existing single migration (`prisma/migrations/20260809184115_init/`, see CLAUDE.md's
  migration-squashing note) is rewritten in Postgres SQL (`SERIAL`, `TIMESTAMP(3)`, etc.) rather
  than SQLite's `AUTOINCREMENT`/`DATETIME`. There is still only one migration — this is an edit of
  that file, not a new one, per the same pre-release-squashing rule.
- Local dev and CI both run against a containerized Postgres via `docker-compose.yml` (services:
  `db` for the app database, an initdb script that additionally provisions a `library_test`
  database for the test suite, and an `api` service that builds the existing `Dockerfile`).
- `DATABASE_URL` changes shape from `file:./dev.db` to a `postgresql://` connection string;
  `.env` / `.env.example` gain `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` to configure
  the compose `db` service without duplicating credentials in two places.
- `tests/global-setup.js` no longer deletes a SQLite file between runs; it runs
  `prisma db push --force-reset` against the test database instead, which gives the same
  "fresh schema every run" guarantee against a real Postgres server.

## Alternatives Considered

- **Stay on SQLite, add a queueing/locking layer for borrow/return.** Rejected: this reintroduces,
  by hand, the concurrent-writer guarantees Postgres already gives for free, and ADR-0001 already
  flagged this exact trade-off as the reason to expect this migration.
- **Managed/hosted Postgres (e.g. RDS, Supabase, Neon) instead of docker-compose.** Out of scope
  for this change: nothing about this project has a deployment target yet (CLAUDE.md: "this
  project has not shipped/deployed yet"), so a docker-compose Postgres service is the right level
  of infrastructure for local dev and mirrors what a future container-based deployment would look
  like, without committing to a specific cloud provider prematurely.
- **MySQL/MariaDB instead of PostgreSQL.** Not seriously considered — ADR-0001 already evaluated
  Postgres specifically (not "a SQL server") as the deferred alternative, and Prisma's support for
  it is equally first-class; there's no reason introduced by this change to revisit that.

## Consequences

**Positive**

- Real multi-writer concurrency, which the upcoming borrow/return endpoints need.
- Local dev now matches the shape of a real deployment (networked database server, not a bundled
  file) which is what `docker-compose.yml` sets up end-to-end.
- Prisma's schema/query layer is unchanged — this is a `datasource` swap plus a migration
  rewrite, not an application code change, exactly as ADR-0001 anticipated.

**Negative / trade-offs accepted**

- Local dev and tests now require `docker compose up -d db` (or an equivalent locally-running
  Postgres) instead of "just works from a checked-out repo" — a real but bounded setup cost.
- The `Dockerfile`'s previous SQLite-specific bits (`VOLUME ["/app/data"]`, a baked-in
  `DATABASE_URL` file default) are removed; the image now requires `DATABASE_URL` to be supplied
  explicitly, same as `JWT_SECRET` already was.

## References

- [`ADR-0001-backend-technology-stack.md`](ADR-0001-backend-technology-stack.md) — original
  SQLite decision and the "Consequences" section anticipating this migration.
- `documents/backend-api-specification.md` Section 9 — borrow/return endpoints motivating the
  timing of this change.
- `docker-compose.yml` — the resulting local Postgres setup.
