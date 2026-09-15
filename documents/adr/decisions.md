# Architecture Decisions

Current decisions for library-api v1 (pre-release). Update this file — don't add new sections — until the project ships.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | |
| Language | JavaScript (ES Modules) | Matches the Vue 3 frontend — one language across both repos, no TS build step for a 3-route service |
| Framework | Express 4 | Lowest-friction option; first-class middleware for CORS and bearer-token auth; no DI/module ceremony needed at this scale |
| Database | PostgreSQL (via Docker) | Upcoming borrow/return endpoints need concurrent writes; SQLite was used initially but couldn't handle multi-writer workloads |
| ORM / queries / seeding | Prisma Client | Declarative schema, generated client, idiomatic JS query API; datasource boundary meant SQLite → PostgreSQL was a one-line change |
| Schema migrations | Liquibase (via Docker) | Changelog-of-changesets model with per-changeset checksums and rollbacks; runs via the official Docker image — no local JVM needed |
| Password hashing | bcryptjs | Direct implementation of spec requirement |
| Tokens | jsonwebtoken (HS256) | Frontend already built around `Authorization: Bearer <token>`; no Passport.js strategy abstraction needed for a single auth method |
| Tests | Vitest + Supertest | Matches the frontend's test runner — same config shape, watch mode, assertion API |
| Package manager | npm | Matches the frontend (`library-portal`) |

**What was rejected:** Fastify/NestJS (overkill ceremony for 3 routes), TypeScript (no build step benefit at this scale — revisit when route count grows), session/cookie auth (the frontend contract is already built around Bearer tokens), Jest (Vitest chosen for cross-repo consistency).

---

## JWT Logout — `jti` Denylist

**Decision:** Every signed token carries a `jti` (UUID) claim. `POST /auth/logout` writes that `jti` + `exp` into a `RevokedToken` table. The `authenticate` middleware, after signature/expiry checks, does one indexed lookup by `jti` — a hit returns 401. Expired rows are pruned inside `revokeToken` on every logout call.

**Why not the alternatives:**
- *Client-only logout* — doesn't actually invalidate the JWT; anyone with a captured token can keep using it.
- *Short-lived tokens + `/refresh`* — reduces blast radius but doesn't provide immediate revocation; complement this approach when `/refresh` is implemented, don't substitute it.
- *Redis blocklist* — adds a second service to hold a handful of rows that an indexed Postgres table already handles in constant time at this scale.
- *`tokenVersion` on `User`* — invalidates all sessions at once ("log out everywhere"), not the single session that called logout.

**Trade-off accepted:** `authenticate` now does a DB read on every protected request. Negligible at MVP scale.

---

## PostgreSQL via Docker Compose

Local dev and CI both use a containerized Postgres (`docker-compose.yml`). The `db` service provisions both `library` (app) and `library_test` (test suite) databases via `docker/init-test-db.sh`. `DATABASE_URL` must be supplied explicitly — the image doesn't bundle a default.

**What was rejected:** Staying on SQLite with a hand-rolled locking layer (reinvents what Postgres gives for free), managed hosted Postgres (no deployment target yet).

---

## Liquibase for Schema Migrations

Migrations live in `liquibase/changesets/*.sql` (SQL formatted changelog, one file per table) wired together by `liquibase/changelog-master.yaml`. Liquibase runs via Docker — `npm run db:migrate` wraps `docker compose run --rm liquibase update`. Tests rebuild from empty on every run via `scripts/migrate-test-db.sh` (`drop-all` + `update`) because changesets are amended in place pre-release rather than layered.

**Prisma's role** is unchanged for everything except migrations: `prisma/schema.prisma` is the source the generated Prisma Client builds from. It must be kept in sync with the Liquibase changesets by hand — both sides change when the schema changes.

**Pre-release rule:** Edit the relevant existing changeset file directly rather than appending a new one. Rebuild both databases from scratch after any schema change (Liquibase checksums applied changesets and refuses to reapply a changed one).

**What was rejected:** Flyway (functionally equivalent — Liquibase was the user's explicit preference), local JVM install (Docker keeps "clone and run" working without a JVM on the host).
