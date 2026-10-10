# Architecture Decisions

Decisions made for library-api v1.0.0. Update this file in place for any new decisions (the project now has a real deployment history, so already-applied changesets are immutable — see the Liquibase section).

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

## JWT Logout and Token Refresh — `jti` Denylist

**Decision:** Every signed token carries a `jti` (UUID) claim. `POST /auth/logout` writes that `jti` + `exp` into a `RevokedToken` table. The `authenticate` middleware, after signature/expiry checks, does one indexed lookup by `jti` — a hit returns 401. Expired rows are pruned inside `revokeToken` on every logout call.

`POST /auth/refresh` reuses the same denylist: the middleware validates the incoming token normally, then the endpoint revokes the old `jti` and signs a new token (fresh `jti` + `exp`, same `sub`/`username`/`role` claims — no user DB read needed). The old token is immediately invalid; the client replaces it in `localStorage`. This is token rotation: the blast radius of a stolen token is bounded by however frequently the client calls `/refresh`.

**Why not the alternatives:**
- *Client-only logout* — doesn't actually invalidate the JWT; anyone with a captured token can keep using it.
- *Short-lived tokens alone* — reduces blast radius but doesn't provide immediate revocation on logout; `/refresh` and logout are now implemented as complements, not substitutes.
- *Redis blocklist* — adds a second service to hold a handful of rows that an indexed Postgres table already handles in constant time at this scale.
- *`tokenVersion` on `User`* — invalidates all sessions at once ("log out everywhere"), not the single session that called logout.

**Trade-off accepted:** `authenticate` now does a DB read on every protected request. Negligible at MVP scale.

---

## PostgreSQL via Docker Compose

Local dev and CI both use a containerized Postgres (`docker-compose.yml`). The `db` service provisions both `library` (app) and `library_test` (test suite) databases via `docker/init-test-db.sh`. `DATABASE_URL` must be supplied explicitly — the image doesn't bundle a default.

**What was rejected:** Staying on SQLite with a hand-rolled locking layer (reinvents what Postgres gives for free), managed hosted Postgres (no deployment target yet).

---

## Liquibase for Schema Migrations

Migrations live in `liquibase/changesets/*.sql` (SQL formatted changelog, one file per table) wired together by `liquibase/changelog-master.yaml`. Liquibase runs via Docker — `npm run db:migrate` wraps `docker compose run --rm liquibase update`. Tests apply pending changesets to `library_test` via `scripts/migrate-test-db.sh` (`update` only; data is kept between runs). `scripts/ensure-test-db.sh --teardown` (or `npm run test:fresh`) drops the test database first to prove the full changeset chain applies cleanly from empty; CI always starts empty.

**Prisma's role** is unchanged for everything except migrations: `prisma/schema.prisma` is the source the generated Prisma Client builds from. It must be kept in sync with the Liquibase changesets by hand — both sides change when the schema changes.

**Deployed rule:** Applied changesets are immutable. Every schema change is a new numbered changeset (with rollback and any needed backfill); Liquibase checksums applied changesets and will not reapply an edited one. (Superseded the earlier pre-release edit-in-place rule after the admin-area change, 006/007, hit a deployed database.)

**What was rejected:** Flyway (functionally equivalent — Liquibase was the user's explicit preference), local JVM install (Docker keeps "clone and run" working without a JVM on the host).

---

## Admin Area — Authorization, Session Cutoff, Audit Log

**Decision:** Admin-only routes sit behind `authenticate` + `requireAdmin`; non-admins get `403 { errorKey: 'admin.forbidden' }`, never 401 (the frontend would log them out). The role is read from the signed JWT claim.

Resetting another user's password must sign that user out everywhere, but the `jti` denylist can only target tokens it has seen. Instead `user.sessions_valid_after` is set to now, and `authenticate` (and `/auth/refresh`) reject any token whose `iat` is at or before that instant (compared in whole seconds, since `iat` has one-second resolution). This reuses the per-request user read `authenticate` already does for the `isActive` check, so it adds no query. A new login within the same second as the reset is also rejected.

Every admin action writes a row to `audit_log` inside the same transaction as the change. There is deliberately no FK to `user`, so the trail survives user deletion; `metadata` must never hold passwords or tokens. `/admin/*` is rate limited to 20 requests/minute per admin with a small in-memory limiter (no new dependency; per-process, so replace it with a shared store if the API ever runs as multiple instances).

**Why not `tokenVersion`:** a timestamp needs no claim changes and no token reissue, and an int counter would not tell us *when* sessions were cut off.

**Book fields:** `year`, `genre`, `isbn`, `summary` are nullable (the admin form treats them as optional). ISBN uniqueness is enforced on a hyphen-free `isbn_normalized` column; `isbn` keeps the caller's spelling.

**User deletion and disabling:** "enabled" in the API is the existing `user.is_active` column (no second flag). `DELETE /admin/users/:username` is a **hard delete**: books store `uploaded_by` as a username string and `audit_log` has no FK, so nothing breaks, and the delete audit entry keeps the username. Tokens of a deleted user die because `isSessionValid` fails for a missing row. Soft delete was rejected for now to keep usernames/emails reusable and every query free of a `deleted_at` filter. Disable/delete take a row lock on all enabled admins (`SELECT ... FOR UPDATE`) in the same transaction as the update, so two admins cannot remove each other concurrently. `user.email` is unique case-insensitively through a `LOWER(email)` index that exists only in Liquibase (Prisma cannot model it).

**Bulk book import (CSV):** `POST /books/import` takes the CSV as a raw `text/csv` body (`express.text`, 1 MB cap) instead of `multipart/form-data`, so no upload library (multer/busboy) is added — a new dependency category per CLAUDE.md. The parser is a small RFC 4180 implementation in `src/lib/csv.js`; row validation reuses `validateNewBook`, so import and single-create can't drift. The import is all-or-nothing in one transaction (validation errors are reported per file line) so a partially-applied file never needs manual cleanup, and writes a single `book.import` audit entry rather than one per row. If imports later need larger files, streaming, or a browser `<form>` upload, revisit with multipart support in a new ADR.

**Book export (CSV):** `GET /books/export` streams the whole catalog in the import format (UTF-8 BOM, CRLF, RFC 4180 quoting, text cells starting with `= + - @ TAB CR` prefixed with `'` against spreadsheet formula injection). Rows are read in 500-row id-ordered batches inside one `RepeatableRead` transaction so the file is a single snapshot without holding the catalog in memory; response headers are sent only after the first reads succeed (earlier failures still return a JSON 500, later ones abort the connection). The `book.export` audit entry is written in that same transaction after the last batch, so failed or aborted exports leave no entry. Rate limited to 10/min per admin with the existing in-memory limiter; CORS exposes `Content-Disposition` and `X-Total-Count`.

---

## Book Reader — PDF Proxy, Progress, Bookmarks, Preferences

**Decision:** Implements `backend-spec-reader.md` (library-portal repo). Changesets 010–013 add `reading_progress` (PK `(user_id, book_id)`), `bookmark` (unique `(user_id, book_id, page)`), `user.reader_preferences` (JSONB) and `book.page_count`; both new tables cascade on user/book deletion. Table names are singular like the rest of the schema (the spec's `bookmarks` was only a suggestion).

**PDF proxy (`GET /books/:id/pdf`):** the server `fetch`es the book's stored `pdf_url` and pipes the body to the client (no buffering); `Range` is forwarded upstream and 206/416 relayed. Google Drive `/file/d/<id>/…` links are rewritten to the download endpoint. No new dependency: Node 20's built-in `fetch` is enough. The `ETag` is a hash of the stored URL, so `If-None-Match` is answered with 304 without touching storage. An upstream non-200/206 status, a non-PDF content type (e.g. Drive's quota/HTML page) or a network error is a `502 reader.sourceUnavailable` with `Cache-Control: no-store`; upstream text and URLs are never returned or logged. `pdfUrl` still returns the stored Drive link — it switches to the proxy URL when the frontend ships phase B.

**Preferences:** only user-set values are stored; defaults (`light`, `fit-width`) are filled in on read, so changing a default later doesn't require a backfill. `PATCH /me` now accepts `locale`, `readerPreferences` or both, validates everything before writing, and merges a partial `readerPreferences` into the stored one.

**Rate limits:** 60/min on the PDF endpoint, 30/min on `PUT /progress`, per user, using the existing in-memory limiter (now with a configurable `errorKey`; reader limits answer `reader.rateLimited`).

---

## Admin Feature Flags

**Decision:** Implements `backend-spec-admin-feature-flags.md` (library-portal repo). Changeset 014 adds `feature_flag` keyed by the flag `key` (immutable, so no surrogate id). `updated_by` is a plain username with no FK, like `uploaded_by` on books, so flags outlive the admin who last touched them. Create, toggle and delete write `admin.feature_flag.*` audit entries in the same transaction; a PATCH that doesn't change `enabled` is a no-op (no audit entry, `updatedAt` untouched). The spec doesn't name a code for a malformed `description`/`enabled`, so those return `422 admin.featureFlags.invalidFields`. Writes share the 60/min `/admin` mutation limiter. `GET /admin/feature-flags` is open to any authenticated user (registered before the admin guard); writes stay admin-only. Nothing in the portal reads flags yet; add a read path when one does.
